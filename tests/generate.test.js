// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ConfigError, generate, googleFonts, WarningError } from "../index.js";
import { createFetch } from "../src/http.js";
import { fixtureFont, hosts, replayFetch, tempDir } from "./support/replay.js";

const PACIFICO = [{ name: "pacifico", cssVariable: "--font-heading", cssSelector: ".page-title", weights: "400" }];
const PACIFICO_FILE = "https://cdn.jsdelivr.net/fontsource/fonts/pacifico@latest/latin-400-normal.woff2";

const PACIFICO_FALLBACK = `@font-face {
    font-family: "pacifico fallback";
    src: local("Arial"), local("Liberation Sans"), local("Arimo");
    size-adjust: 92.43%;
    ascent-override: 140.97%;
    descent-override: 49.01%;
    line-gap-override: 0%;
}`;

/**
 * Generates into a new folder on the recorded responses.
 *
 * @param {unknown} fonts
 * @param {object} [options]
 * @returns {Promise<{result: import("../index.js").Result, fetch: ReturnType<typeof replayFetch>, storage: string}>}
 */
async function run(fonts, { fetch = replayFetch(), storage = tempDir(), ...options } = {}) {
	const result = await generate(fonts, { storage, fetch, ...options });

	return { result, fetch, storage };
}

describe("generate", () => {
	test("downloads the woff2 and measures it for the fallback face", async () => {
		const { result, storage } = await run(PACIFICO);

		assert.deepEqual(result.warnings, []);
		assert.ok(result.css().includes(PACIFICO_FALLBACK));
		assert.ok(fs.existsSync(path.join(storage, "pacifico-latin-400-normal.woff2")));
		assert.equal(result.downloaded(), 1);
	});

	test("does not download a file that is present", async () => {
		const { storage } = await run(PACIFICO);
		const { result, fetch } = await run(PACIFICO, { storage });

		assert.equal(result.downloads[0].status, "present");
		assert.equal(result.downloaded(), 0);
		assert.ok(!fetch.requests.includes(PACIFICO_FILE));
	});

	test("names a file without an extension as woff2", async () => {
		const { result } = await run([{ name: "Source Code Pro", provider: "google-fonts", weights: [400, 600] }]);

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.families[0].faces.flatMap((face) => face.files), ["source-code-pro-latin-400-600-normal.woff2"]);
		assert.ok(result.css().includes('format("woff2")'));
	});

	test("refuses a download from another host", async () => {
		const css = "/* latin */\n@font-face { font-family: 'Inter'; src: url(https://evil.example/inter.woff2) format('woff2'); }";
		const fetch = replayFetch({ overrides: { "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap": { body: css } } });
		const { result } = await run([{ name: "Inter", provider: "google-fonts" }], { fetch });

		assert.equal(result.downloads[0].status, "failed");
		assert.equal(result.downloads[0].error, "not a host this provider serves fonts from");
		assert.deepEqual(result.families[0].faces, []);
		assert.ok(!fetch.requests.includes("https://evil.example/inter.woff2"));
	});

	test("refuses a body that is not a woff2", async () => {
		const { result, storage } = await run(PACIFICO, { fetch: replayFetch({ overrides: { [PACIFICO_FILE]: { body: "<html>" } } }) });

		assert.equal(result.downloads[0].error, "not a woff2 file");
		assert.ok(!fs.existsSync(path.join(storage, "pacifico-latin-400-normal.woff2")));
	});

	test("refuses a file over the size limit", async () => {
		const { result } = await run(PACIFICO, { maxFileSize: 1000 });

		assert.equal(result.downloads[0].error, "larger than 1000 bytes");
	});

	test("strict mode throws with the result attached", async () => {
		await assert.rejects(run(PACIFICO, { fetch: replayFetch({ offline: true }), strict: true }), (error) => {
			assert.ok(error instanceof WarningError);
			assert.equal(error.result.warnings.length, 1);
			assert.ok(error.result.css().includes("--font-heading: pacifico, sans-serif;"));
			return true;
		});
	});

	test("an invalid config throws before any request", async () => {
		const fetch = replayFetch();

		await assert.rejects(run([{ name: "Inter", styles: ["bold"] }, { name: "" }], { fetch }), (error) => {
			assert.ok(error instanceof ConfigError);
			assert.deepEqual(error.errors, [
				'fonts[0].styles only supports "normal" and "italic", received: bold.',
				"fonts[1].name is required.",
			]);
			return true;
		});
		assert.deepEqual(fetch.requests, []);
	});

	test("splits the stylesheet for inline use", async () => {
		const { result } = await run(PACIFICO, { urlBase: "https://example.com/media/fonts" });

		assert.ok(result.css().startsWith("@font-face {"));
		assert.ok(result.fontFaceCss().includes('url("https://example.com/media/fonts/pacifico-latin-400-normal.woff2")'));
		assert.ok(!result.fontFaceCss().includes("--font-"));
		assert.equal(result.variablesCss(), '.page-title {\n    --font-heading: pacifico, "pacifico fallback", sans-serif;\n}');
	});

	test("variables for CSS that declares them itself", async () => {
		const { result, storage } = await run([
			{ name: "pacifico", cssVariable: "--font-heading" },
			{ name: "Roboto", weights: [400, 700], cssVariable: "font-body", fallbacks: ["cursive"] },
		]);

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.variables(), {
			"--font-heading": 'pacifico, "pacifico fallback", sans-serif',
			"--font-body": "Roboto, cursive",
		});
		assert.deepEqual(fs.readdirSync(storage).sort(), [
			"pacifico-latin-400-normal.woff2",
			"roboto-latin-400-normal.woff2",
			"roboto-latin-700-normal.woff2",
		]);
	});

	test("preloads", async () => {
		const { result } = await run([{ ...PACIFICO[0], preload: true }], { urlBase: "/media/fonts" });

		assert.equal(
			result.preloadHtml(),
			'<link rel="preload" as="font" type="font/woff2" href="/media/fonts/pacifico-latin-400-normal.woff2" crossorigin>',
		);
	});

	test("no fonts", async () => {
		const { result } = await run([]);

		assert.equal(result.css(), "");
	});

	test("local fonts need no fetch", async () => {
		const storage = tempDir();
		fs.mkdirSync(path.join(storage, "brand"));
		fs.writeFileSync(path.join(storage, "brand/brand.ttf"), fixtureFont("substitute.ttf"));
		const fetch = replayFetch({ offline: true });

		const { result } = await run([{ provider: "local", name: "Brand", variants: [{ src: ["brand/brand.ttf"] }] }], { storage, fetch });

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(fetch.requests, []);
		assert.ok(result.css().includes('url("/fonts/brand/brand.ttf") format("truetype")'));
		assert.ok(result.css().includes("size-adjust: 92.43%;"));
	});

	test("a missing local file is a warning", async () => {
		const { result } = await run([{ provider: "local", name: "Brand", variants: [{ src: ["brand.woff2"] }] }]);

		assert.match(result.warnings[0], /^Skipped "Brand", it could not be resolved\.\n {2}Missing font files for "Brand" in .+:\n {2}brand\.woff2$/);
	});

	test("refuses hosts with an address that is not public", async () => {
		hosts["cdn.jsdelivr.net"] = ["8.8.8.8", "10.0.0.1"];
		try {
			const { result, fetch } = await run(PACIFICO);
			assert.equal(result.downloads[0].error, "cdn.jsdelivr.net resolves to 10.0.0.1, which is not a public address");
			assert.ok(!fetch.requests.includes(PACIFICO_FILE));

			const allowed = await run(PACIFICO, { allowPrivateAddresses: true });
			assert.equal(allowed.result.downloads[0].status, "downloaded");
		} finally {
			delete hosts["cdn.jsdelivr.net"];
		}
	});

	test("refuses addresses that are not public, in any spelling", async () => {
		const css = (host) => `/* latin */\n@font-face { src: url(https://${host}/inter.woff2) format('woff2'); }`;
		const request = "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap";
		const errors = [];
		for (const host of ["169.254.169.254", "0177.0.0.1", "2130706433", "100.64.0.1"]) {
			const fetch = replayFetch({ overrides: { [request]: { body: css(host) } } });
			const { result } = await run([{ name: "Inter", provider: "google-fonts" }], { fetch, providers: [googleFonts({ downloadHosts: [host] })] });
			errors.push(result.downloads[0].error);
		}

		assert.deepEqual(errors, [
			"169.254.169.254 is not a public address",
			"127.0.0.1 is not a public address",
			"127.0.0.1 is not a public address",
			"100.64.0.1 is not a public address",
		]);
	});

	test("the default fetch checks the address it connects to", async () => {
		hosts["internal.example"] = ["192.168.1.10"];
		try {
			const fetch = createFetch(null, false);
			await assert.rejects(fetch("https://internal.example/a.woff2"), { message: "internal.example resolves to 192.168.1.10, which is not a public address" });
			await assert.rejects(fetch("https://[::1]/a.woff2"), { message: "::1 is not a public address" });
			await assert.rejects(fetch("https://[::ffff:127.0.0.1]/"), { message: "::ffff:7f00:1 is not a public address" });
			await assert.rejects(fetch("https://[fd00::1]/"), { message: "fd00::1 is not a public address" });
			await assert.rejects(createFetch(replayFetch(), false)("https://internal.example/"), { message: "internal.example resolves to 192.168.1.10, which is not a public address" });
		} finally {
			delete hosts["internal.example"];
		}
	});

	test("does not follow redirects", async () => {
		const fetch = replayFetch({ overrides: { [PACIFICO_FILE]: { status: 302, headers: { location: "https://evil.example/pacifico.woff2" } } } });
		const { result } = await run(PACIFICO, { fetch });

		assert.equal(result.downloads[0].error, "HTTP 302");
		assert.ok(!fetch.requests.includes("https://evil.example/pacifico.woff2"));
	});

	test("tries a failed request twice more", async () => {
		const fetch = replayFetch({ overrides: { [PACIFICO_FILE]: { status: 503 }, "https://api.fontsource.org/v1/fonts/roboto": { status: 404 } } });
		const { result } = await run([...PACIFICO, { name: "Roboto" }], { fetch });

		assert.equal(result.downloads[0].error, "HTTP 503");
		assert.equal(fetch.requests.filter((url) => url === PACIFICO_FILE).length, 3);
		assert.equal(fetch.requests.filter((url) => url.endsWith("/roboto")).length, 1);

		const offline = replayFetch({ offline: true });
		await run(PACIFICO, { fetch: offline });
		assert.equal(offline.requests.length, 3);
	});

	test("files over the limit are not downloaded", async () => {
		const { result } = await run([{ name: "Roboto", weights: [400, 700] }], { maxFiles: 1 });

		assert.deepEqual(result.downloads.map((download) => download.error), [null, "the run reached its limit of 1 font files"]);
		assert.match(result.warnings[0], /^Could not download 1 font file\(s\) for "Roboto"\./);
	});

	test("bytes over the limit are not stored", async () => {
		const { result, storage } = await run(PACIFICO, { maxTotalBytes: 1000 });

		assert.equal(result.downloads[0].error, "the run reached its limit of 1000 bytes");
		assert.deepEqual(fs.readdirSync(storage), []);
	});
});
