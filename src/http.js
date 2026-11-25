// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import dns from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

/** A larger response is refused rather than read into memory. */
const MAX_BYTES = 20 * 1024 * 1024;

/** A failed request or a 429 or 5xx response is tried this many times in all, `delay` milliseconds apart. */
export const RETRY = { attempts: 3, delay: 500 };

/**
 * Addresses a request may not go to: private, loopback, link local (such as
 * 169.254.169.254), CGNAT, multicast and reserved IPv4, and IPv6 outside
 * global unicast 2000::/3, which covers IPv4 mapped, NAT64, unique local and
 * link local addresses.
 */
const NOT_PUBLIC = { 4: new BlockList(), 6: new BlockList() };
for (const range of [
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
	"192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
	"224.0.0.0/4", "240.0.0.0/4", "::/3", "4000::/2", "8000::/1", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20",
]) {
	const [network, prefix] = range.split("/");
	const family = isIP(network);
	NOT_PUBLIC[family].addSubnet(network, Number(prefix), `ipv${family}`);
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isPublicAddress(address) {
	const family = isIP(address);

	// Each family has its own list, a BlockList checks IPv4 against IPv6 rules as IPv4 mapped.
	return family !== 0 && !NOT_PUBLIC[family].check(address, `ipv${family}`);
}

/**
 * An error that trying again will not fix.
 *
 * @param {string} message
 * @returns {Error}
 */
function refused(message) {
	return Object.assign(new Error(message), { retry: false });
}

/**
 * A `dns.lookup` that fails when the host has an address that is not public.
 *
 * @type {import("node:net").LookupFunction}
 */
function lookupPublic(host, options, callback) {
	dns.lookup(host, { ...options, all: true }, (error, addresses) => {
		const blocked = addresses?.find(({ address }) => !isPublicAddress(address));
		if (error || !addresses?.length) {
			callback(refused(`could not resolve ${host}`));
		} else if (blocked) {
			callback(refused(`${host} resolves to ${blocked.address}, which is not a public address`));
		} else if (options.all) {
			callback(null, addresses);
		} else {
			callback(null, addresses[0].address, addresses[0].family);
		}
	});
}

/**
 * Refuses a URL whose host is, or resolves to, an address that is not public.
 *
 * @param {string} url
 * @returns {Promise<void>}
 */
async function checkHost(url) {
	const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
	if (isIP(host)) {
		if (!isPublicAddress(host)) throw refused(`${host} is not a public address`);
		return;
	}

	await new Promise((resolve, reject) => lookupPublic(host, {}, (error) => (error ? reject(error) : resolve())));
}

const publicAgent = new https.Agent({ lookup: lookupPublic });

/**
 * The `fetch` of a run. Without one given, it is a `node:https` client whose
 * lookup refuses addresses that are not public, so the address it checks is
 * the address it connects to. A given `fetch`, such as one for a proxy, gets
 * the host checked before each request instead. Redirects are never followed.
 *
 * @param {typeof fetch|null} fetcher
 * @param {boolean} allowPrivateAddresses
 * @returns {typeof fetch}
 */
export function createFetch(fetcher, allowPrivateAddresses) {
	if (fetcher !== null) {
		return async (url, init = {}) => {
			if (!allowPrivateAddresses) await checkHost(String(url));
			return fetcher(url, { ...init, redirect: "manual" });
		};
	}

	return async (url, init = {}) => {
		if (!allowPrivateAddresses && isIP(new URL(url).hostname.replace(/^\[|\]$/g, ""))) await checkHost(String(url));

		return new Promise((resolve, reject) => {
			const options = { headers: init.headers, signal: init.signal, agent: allowPrivateAddresses ? undefined : publicAgent };
			https.get(url, options, (response) => {
				const empty = [204, 304].includes(response.statusCode);
				if (empty) response.resume();
				resolve(new Response(empty ? null : Readable.toWeb(response), {
					status: response.statusCode,
					headers: Object.entries(response.headers).flatMap(([name, value]) => [value].flat().map((item) => [name, item])),
				}));
			}).on("error", reject);
		});
	};
}

/**
 * @typedef {object} HttpResponse
 * @property {number} status
 * @property {Buffer} body
 * @property {boolean} ok - the status is in the 2xx range
 */

/**
 * Makes a GET request and reads the whole body, trying again after a failed
 * connection or a 429 or 5xx response.
 *
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<HttpResponse>} any status, only a failed connection rejects
 */
export async function request(fetcher, url, headers = {}) {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await requestOnce(fetcher, url, headers);
			if (attempt >= RETRY.attempts || (response.status !== 429 && response.status < 500)) return response;
		} catch (error) {
			if (attempt >= RETRY.attempts || error.retry === false) throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, RETRY.delay));
	}
}

/**
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<HttpResponse>}
 */
async function requestOnce(fetcher, url, headers) {
	const response = await fetcher(url, { headers, redirect: "manual" });
	const chunks = [];
	let size = 0;

	if (response.body) {
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > MAX_BYTES) {
				await response.body.cancel?.().catch(() => {});
				throw refused(`response larger than ${MAX_BYTES} bytes`);
			}
			chunks.push(chunk);
		}
	}

	return {
		status: response.status,
		body: Buffer.concat(chunks),
		ok: response.status >= 200 && response.status < 300,
	};
}

/**
 * Whether a URL is https and on one of the given hosts, so a response can
 * never point a download at an internal address. A URL with credentials or
 * a port is refused as well.
 *
 * @param {string} url
 * @param {string[]} hosts
 * @returns {boolean}
 */
export function allowsHost(url, hosts) {
	const authority = /^https:\/\/([^/?#]+)/i.exec(url)?.[1];

	return authority !== undefined && !/[@:]/.test(authority) && hosts.includes(authority.toLowerCase());
}
