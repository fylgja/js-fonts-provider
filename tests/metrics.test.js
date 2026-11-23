// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readMetrics } from "../index.js";
import { fixtureFont } from "./support/replay.js";

/** The same font as a woff2, woff and ttf. */
const PACIFICO = { unitsPerEm: 1000, ascent: 1303, descent: -453, lineGap: 0, xWidthAvg: 408 };

describe("readMetrics", () => {
	test("reads woff2, woff and ttf alike", () => {
		for (const file of ["substitute.woff2", "substitute.woff", "substitute.ttf"]) {
			assert.deepEqual(readMetrics(fixtureFont(file)), PACIFICO, file);
		}
	});

	test("reads otf and a format 12 cmap", () => {
		assert.ok(readMetrics(fixtureFont("source-sans-3.otf")));
		assert.ok(readMetrics(fixtureFont("noto-sans-math.ttf")));
	});

	test("returns null for broken input", () => {
		assert.equal(readMetrics(Buffer.alloc(0)), null);
		assert.equal(readMetrics(Buffer.from("not a font at all")), null);
		assert.equal(readMetrics(fixtureFont("substitute.ttf").subarray(0, 400)), null);
		assert.equal(readMetrics(fixtureFont("substitute.woff").subarray(0, 400)), null);
		assert.equal(readMetrics(fixtureFont("substitute.woff2").subarray(0, 400)), null);
	});
});
