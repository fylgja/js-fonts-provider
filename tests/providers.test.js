// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { generate, normalize } from "../index.js";
import { buildCss2Url } from "../src/providers/css2.js";
import { replayFetch, tempDir } from "./support/replay.js";

/**
 * @param {unknown} fonts
 * @returns {Promise<import("../index.js").Result>}
 */
const run = (fonts) => generate(fonts, { storage: tempDir(), fetch: replayFetch() });

/**
 * @param {import("../index.js").Result} result
 * @returns {string[][]}
 */
const files = (result) => result.families.map((family) => [...new Set(family.faces.flatMap((face) => face.files))]);

describe("providers", () => {
	test("fontsource variable font", async () => {
		const result = await run([
			{ name: "Inter", weights: ["100 900"], styles: ["normal", "italic"], subsets: ["latin", "latin-ext"] },
		]);

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(files(result), [[
			"inter-latin-100-900-normal.woff2",
			"inter-latin-ext-100-900-normal.woff2",
			"inter-latin-100-900-italic.woff2",
			"inter-latin-ext-100-900-italic.woff2",
		]]);
		assert.ok(result.css().includes('font-weight: 100 900;\n    font-display: swap;\n    src: url("/fonts/inter-latin-100-900-normal.woff2") format("woff2");\n    unicode-range: U+0000-00FF,'));
		assert.equal(result.families[0].fallbackFace?.sizeAdjust, "107.3%");
	});

	test("google fonts variable font", async () => {
		const result = await run([
			{ name: "Inter", provider: "google-fonts", weights: ["100 900"], styles: ["normal", "italic"], subsets: ["latin", "latin-ext"] },
		]);

		assert.deepEqual(result.warnings, []);
		assert.equal(files(result)[0].length, 4);
		assert.ok(result.families[0].fallbackFace);
	});

	test("bunny fonts", async () => {
		const result = await run([{ name: "Roboto", provider: "bunny-fonts", weights: [400, 700], styles: ["normal", "italic"] }]);

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(files(result), [[
			"roboto-latin-400-normal.woff2",
			"roboto-latin-700-normal.woff2",
			"roboto-latin-400-italic.woff2",
			"roboto-latin-700-italic.woff2",
		]]);
		assert.ok(result.families[0].fallbackFace);
	});

	test("fontshare", async () => {
		const result = await run([
			{ name: "Satoshi", provider: "fontshare", weights: [400, 700], styles: ["normal", "italic"] },
			{ name: "JetBrains Mono", provider: "fontshare", id: "jet-brains-mono", fallbacks: ["monospace"] },
		]);

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(files(result), [
			["satoshi-400-normal.woff2", "satoshi-700-normal.woff2", "satoshi-400-italic.woff2", "satoshi-700-italic.woff2"],
			["jetbrains-mono-400-normal.woff2"],
		]);
	});

	test("fontshare without the weight", async () => {
		const result = await run([{ name: "Satoshi", provider: "fontshare", weights: [950] }]);

		assert.ok(result.warnings[0].startsWith('Skipped "Satoshi", it could not be resolved.\n  Fontshare returned no woff2 files'));
		assert.deepEqual(result.families[0].faces, []);
	});

	test("unknown families", async () => {
		const result = await run([
			{ name: "Not A Real Font" },
			{ name: "Not A Real Font", provider: "google-fonts", cssVariable: "--a" },
			{ name: "Not A Real Font", provider: "bunny-fonts", cssVariable: "--b" },
		]);

		assert.equal(result.warnings.length, 3);
		assert.ok(result.warnings[0].includes('Fontsource has no font with the id "not-a-real-font"'));
		assert.ok(result.warnings[1].includes('Google Fonts rejected "Not A Real Font" (HTTP 400): 400: Font family not found'));
		assert.ok(result.warnings[2].includes(`Bunny Fonts returned no woff2 files for "Not A Real Font": Please specify a valid font on the 'family' parameter.`));
		assert.equal(result.fontFaceCss(), "");
		assert.deepEqual(Object.keys(result.variables()), ["--font-not-a-real-font", "--a", "--b"]);
	});

	test("the CSS2 request encodes the family name", () => {
		const font = normalize([{ name: "Open Sans&x=1#", provider: "google-fonts" }]).fonts[0];

		assert.equal(
			buildCss2Url("https://fonts.googleapis.com/css2", font),
			"https://fonts.googleapis.com/css2?family=Open+Sans%26x%3D1%23:wght@400&display=swap",
		);
	});
});
