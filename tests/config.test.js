// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { normalize, slugify } from "../index.js";

const UNSAFE = {
	"quote in name": [{ name: 'Inter"; } body { color: red' }, "fonts[0].name contains characters that are not allowed in a font family name."],
	"style tag in name": [{ name: "</style><script>" }, "fonts[0].name contains characters that are not allowed in a font family name."],
	"css variable": [{ name: "Inter", cssVariable: "--font: red;" }, 'fonts[0].cssVariable "--font: red;" is not a valid custom property name.'],
	"selector": [{ name: "Inter", cssSelector: ":root{}" }, "fonts[0].cssSelector contains characters that are not allowed in a selector."],
	"comment in selector": [{ name: "Inter", cssSelector: ":root /*" }, "fonts[0].cssSelector contains characters that are not allowed in a selector."],
	"id": [{ name: "Inter", id: "../../etc" }, 'fonts[0].id "../../etc" may only contain letters, digits, "-" and "_".'],
	"display": [{ name: "Inter", display: "swap;color:red" }, "fonts[0].display must be one of: auto, block, swap, fallback, optional."],
	"fallback": [{ name: "Inter", fallbacks: ["sans-serif", "x;}"] }, "fonts[0].fallbacks has a value that is not a font family name: x;}."],
	"weight": [{ name: "Inter", weights: ["bold"] }, 'fonts[0].weights has "bold", which is not a number or a range of numbers.'],
	"subset": [{ name: "Inter", subsets: ["../x"] }, 'fonts[0].subsets has "../x", which is not a valid subset name.'],
	"local path": [
		{ provider: "local", name: "Brand", variants: [{ src: ["../secret.woff2"] }] },
		'fonts[0].variants[0].src "../secret.woff2" must be a path inside the fonts folder.',
	],
	"local stretch": [
		{ provider: "local", name: "Brand", variants: [{ src: ["a.woff2"], stretch: "100%;}" }] },
		"fonts[0].variants[0].stretch contains characters that are not allowed.",
	],
	"non string option": [{ name: "Inter", cssVariable: 5 }, "fonts[0].cssVariable must be a string."],
};

describe("normalize", () => {
	for (const [name, [font, error]] of Object.entries(UNSAFE)) {
		test(`rejects ${name}`, () => {
			assert.deepEqual(normalize([font]).errors, [error]);
		});
	}

	test("accepts quoted and named fallbacks", () => {
		const config = normalize([{ name: "Inter", fallbacks: ['"Helvetica Neue"', "'Segoe UI'", "Arial", "system-ui"] }]);

		assert.deepEqual(config.errors, []);
	});

	test("rejects wrong types", () => {
		const config = normalize([{ name: "Inter", styles: "italic", weights: [400.5], preload: "yes" }]);

		assert.deepEqual(config.errors, [
			"fonts[0].preload must be true or false.",
			"fonts[0].styles must be a list of strings.",
			'fonts[0].weights must be a number, a range such as "100 900", or a list of those.',
		]);
	});

	test("fills in the defaults", () => {
		const [family] = normalize([{ name: "Inter", weights: [700, "400"] }]).fonts;

		assert.equal(family.provider, "fontsource");
		assert.equal(family.cssVariable, "--font-inter");
		assert.deepEqual(family.weights.map((weight) => weight.css), ["400", "700"]);
		assert.deepEqual(family.styles, ["normal"]);
		assert.deepEqual(family.subsets, ["latin"]);
		assert.deepEqual(family.fallbacks, ["sans-serif"]);
	});

	test("refuses overlapping weights and ranges a provider does not serve", () => {
		const config = normalize([
			{ name: "Inter", weights: ["300 700", 400] },
			{ name: "Roboto", provider: "bunny-fonts", weights: ["100 900"] },
		]);

		assert.deepEqual(config.errors, [
			'fonts[0].weights lists "400" and "300 700", which cover the same weight. Use either the range or the single weights.',
			'fonts[1].weights uses the range "100 900", which Bunny Fonts does not serve. Bunny Fonts serves static files only, list the weights you need instead of a range.',
		]);
	});

	test("slugifies names", () => {
		assert.equal(slugify("JetBrains Mono"), "jetbrains-mono");
		assert.equal(slugify("Señor Café"), "senor-cafe");
		assert.equal(slugify("  M PLUS 1p "), "m-plus-1p");
	});
});
