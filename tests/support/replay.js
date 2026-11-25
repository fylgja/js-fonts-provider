// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { createHash } from "node:crypto";
import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURES = new URL("../fixtures/", import.meta.url);

/** Addresses by host for the fake DNS, every other host resolves to a public address. */
export const hosts = {};

// Tests never look up a name, the address check runs on these answers.
// Recording needs the real DNS to reach the live API.
if (!process.env.FONTS_RECORD) {
	dns.lookup = (host, options, callback) => {
		callback(null, (hosts[host] ?? ["8.8.8.8"]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
	};
}

/** Fontshare fonts may not be redistributed, an OFL font of the same format is stored instead. */
const SUBSTITUTE_HOSTS = ["cdn.fontshare.com"];

/**
 * Reads a recorded response, keyed by the SHA-1 of the URL.
 *
 * @param {string} url
 * @returns {{status: number, body: Buffer}|null}
 */
function load(url) {
	const key = createHash("sha1").update(url).digest("hex");
	const file = new URL(`http/${key}.json`, FIXTURES);
	if (!fs.existsSync(file)) return null;

	const meta = JSON.parse(fs.readFileSync(file, "utf8"));
	const body = meta.bodyFile
		? fs.readFileSync(new URL(`http/${meta.bodyFile}`, FIXTURES))
		: Buffer.from(meta.body ?? "", "utf8");

	return { status: meta.status, body };
}

/**
 * Stores a response as a fixture.
 *
 * @param {string} url
 * @param {number} status
 * @param {Buffer} body
 * @returns {void}
 */
function save(url, status, body) {
	const key = createHash("sha1").update(url).digest("hex");
	const meta = { url, status };
	const text = body.toString("utf8");

	if (!text.includes("\0") && Buffer.from(text, "utf8").equals(body)) {
		meta.body = text;
	} else {
		meta.bodyFile = `${key}.bin`;
		fs.writeFileSync(new URL(`http/${key}.bin`, FIXTURES), body);
	}

	fs.writeFileSync(new URL(`http/${key}.json`, FIXTURES), `${JSON.stringify(meta, null, 4)}\n`);
}

/**
 * Records a response from the live API, replacing Fontshare files.
 *
 * @param {string} url
 * @param {RequestInit} init
 * @returns {Promise<{status: number, body: Buffer}>}
 */
async function record(url, init) {
	const response = await fetch(url, init);
	let body = Buffer.from(await response.arrayBuffer());

	if (response.ok && SUBSTITUTE_HOSTS.includes(new URL(url).host)) {
		const substitute = new URL(`fonts/substitute.${path.extname(new URL(url).pathname).slice(1)}`, FIXTURES);
		if (fs.existsSync(substitute)) body = fs.readFileSync(substitute);
	}

	save(url, response.status, body);
	return { status: response.status, body };
}

/**
 * A `fetch` on the recorded responses. Set `FONTS_RECORD=1` to record the
 * responses a new test needs from the live API.
 *
 * @param {{overrides?: Record<string, {status?: number, headers?: Record<string, string>, body?: string}>, offline?: boolean}} [options]
 *   - responses by URL, before the fixtures, and whether every request fails
 * @returns {typeof fetch & {requests: string[]}}
 */
export function replayFetch({ overrides = {}, offline = false } = {}) {
	const replay = async (url, init) => {
		replay.requests.push(url);

		if (offline) throw new Error("offline");

		const fixture = overrides[url]
			? { status: overrides[url].status ?? 200, headers: overrides[url].headers, body: Buffer.from(overrides[url].body ?? "") }
			: load(url) ?? (process.env.FONTS_RECORD ? await record(url, init) : null);

		if (fixture === null) {
			throw new Error(`No fixture for ${url}, run the tests with FONTS_RECORD=1 to record it.`);
		}

		return new Response(fixture.body, { status: fixture.status, headers: fixture.headers });
	};
	replay.requests = [];

	return replay;
}

const tempDirs = [];
process.on("exit", () => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A new, empty fonts folder, removed when the tests are done.
 *
 * @returns {string}
 */
export function tempDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fylgja-fonts-"));
	tempDirs.push(dir);

	return dir;
}

/**
 * @param {string} name
 * @returns {Buffer}
 */
export function fixtureFont(name) {
	return fs.readFileSync(new URL(`fonts/${name}`, FIXTURES));
}
