// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

/** A larger response is refused rather than read into memory. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * @typedef {object} HttpResponse
 * @property {number} status
 * @property {Buffer} body
 * @property {boolean} ok - the status is in the 2xx range
 */

/**
 * Makes a GET request and reads the whole body.
 *
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {Record<string, string>} [headers]
 * @returns {Promise<HttpResponse>} any status, only a failed connection rejects
 */
export async function request(fetcher, url, headers = {}) {
	const response = await fetcher(url, { headers, redirect: "follow" });
	const chunks = [];
	let size = 0;

	if (response.body) {
		for await (const chunk of response.body) {
			size += chunk.length;
			if (size > MAX_BYTES) {
				await response.body.cancel?.().catch(() => {});
				throw new Error(`response larger than ${MAX_BYTES} bytes`);
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
