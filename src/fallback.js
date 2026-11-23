// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { formatPercent } from "./format.js";

/**
 * A `@font-face` that makes a locally installed font take up the same space
 * as the webfont, so swapping one for the other does not move the page.
 *
 * @typedef {object} FallbackFace
 * @property {string} family - "<name> fallback"
 * @property {string[]} local - metrically compatible local font names
 * @property {string} sizeAdjust - percentages, such as "92.43%"
 * @property {string} ascentOverride
 * @property {string} descentOverride
 * @property {string} lineGapOverride
 */

/**
 * Metrics of the fonts a visitor is likely to already have, measured with
 * the same code that measures a webfont so the two are comparable. Each
 * lists the families that are metrically compatible with it.
 */
const SYSTEM_FONTS = {
	"arial": {
		local: ["Arial", "Liberation Sans", "Arimo"],
		unitsPerEm: 2048, ascent: 1854, descent: -434, lineGap: 67, xWidthAvg: 904,
	},
	"times new roman": {
		local: ["Times New Roman", "Liberation Serif", "Tinos"],
		unitsPerEm: 2048, ascent: 1825, descent: -443, lineGap: 87, xWidthAvg: 819,
	},
	"courier new": {
		local: ["Courier New", "Liberation Mono", "Cousine"],
		unitsPerEm: 2048, ascent: 1705, descent: -615, lineGap: 0, xWidthAvg: 1229,
	},
	"georgia": {
		local: ["Georgia", "Gelasio"],
		unitsPerEm: 2048, ascent: 1878, descent: -449, lineGap: 0, xWidthAvg: 899,
	},
	"verdana": {
		local: ["Verdana", "DejaVu Sans"],
		unitsPerEm: 2048, ascent: 2059, descent: -430, lineGap: 0, xWidthAvg: 1041,
	},
	"tahoma": {
		local: ["Tahoma"],
		unitsPerEm: 2048, ascent: 2049, descent: -423, lineGap: 0, xWidthAvg: 912,
	},
	"trebuchet ms": {
		local: ["Trebuchet MS"],
		unitsPerEm: 2048, ascent: 1923, descent: -455, lineGap: 0, xWidthAvg: 929,
	},
};

/** The font a generic family name stands in for when nothing else is named. */
const GENERIC_FONTS = {
	"sans-serif": "arial",
	"ui-sans-serif": "arial",
	"system-ui": "arial",
	"serif": "times new roman",
	"ui-serif": "times new roman",
	"monospace": "courier new",
	"ui-monospace": "courier new",
};

/**
 * Chooses which of a family's fallbacks to adjust. A named font wins over
 * a generic one, since that is what the visitor will actually see.
 *
 * @param {string[]} fallbacks - the configured font stack, without the family
 * @returns {(typeof SYSTEM_FONTS)[string]|null}
 */
export function pickFallback(fallbacks) {
	for (const name of fallbacks) {
		const key = name.toLowerCase().replace(/^['"]|['"]$/g, "");
		if (Object.hasOwn(SYSTEM_FONTS, key)) return SYSTEM_FONTS[key];
	}

	for (const name of fallbacks) {
		const generic = GENERIC_FONTS[name.toLowerCase()];
		if (generic) return SYSTEM_FONTS[generic];
	}

	return null;
}

/**
 * Builds the adjusted fallback face of a family.
 *
 * @param {string} name - the family name
 * @param {string[]} fallbacks
 * @param {import("./metrics.js").Metrics} metrics - of the webfont
 * @returns {FallbackFace|null} null when no fallback is known
 */
export function buildFallbackFace(name, fallbacks, metrics) {
	const fallback = pickFallback(fallbacks);
	if (fallback === null || metrics.unitsPerEm <= 0 || metrics.xWidthAvg <= 0) {
		return null;
	}

	// How much wider or narrower the webfont is than the font standing in
	// for it. The overrides apply to the already scaled font.
	const sizeAdjust = metrics.xWidthAvg / metrics.unitsPerEm / (fallback.xWidthAvg / fallback.unitsPerEm);
	const scaled = metrics.unitsPerEm * sizeAdjust;

	return {
		family: `${name} fallback`,
		local: fallback.local,
		sizeAdjust: formatPercent(sizeAdjust),
		ascentOverride: formatPercent(metrics.ascent / scaled),
		descentOverride: formatPercent(Math.abs(metrics.descent) / scaled),
		lineGapOverride: formatPercent(metrics.lineGap / scaled),
	};
}
