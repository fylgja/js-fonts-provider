// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { fetchFaces } from "../api/stylesheet.js";
import { allowsHost } from "../http.js";

/** @typedef {import("./index.js").Provider} Provider */
/** @typedef {import("../config.js").Family} Family */

/**
 * Encodes a value like PHP's `rawurlencode()`, which also encodes `!'()*`.
 *
 * @param {string} value
 * @returns {string}
 */
function rawUrlEncode(value) {
	return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Builds the request URL of a CSS2 API.
 *
 * @param {string} endpoint
 * @param {Family} font
 * @returns {string}
 */
export function buildCss2Url(endpoint, font) {
	const family = font.name.trim().split(/\s+/).map(rawUrlEncode).join("+");
	const weights = font.weights.map((weight) => weight.api);

	let axis;
	if (font.styles.includes("italic")) {
		const tuples = [
			...(font.styles.includes("normal") ? weights.map((weight) => `0,${weight}`) : []),
			...weights.map((weight) => `1,${weight}`),
		];
		axis = `ital,wght@${tuples.join(";")}`;
	} else {
		axis = `wght@${weights.join(";")}`;
	}

	return `${endpoint}?family=${family}:${axis}&display=${font.display}`;
}

/**
 * A provider backed by the CSS2 API, which Google Fonts introduced and Bunny
 * Fonts implements as a drop in replacement.
 *
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.label
 * @param {string} options.endpoint
 * @param {boolean} options.variable - whether the endpoint serves variable fonts
 * @param {string|null} options.note - extra guidance shown with a validation error
 * @param {string[]} options.downloadHosts - hosts the font files may come from
 * @returns {Provider}
 */
function css2Provider({ id, label, endpoint, variable, note, downloadHosts }) {
	return {
		id,
		label,
		remote: true,
		subsets: true,
		variable,
		note,
		resolve: (font, context) => fetchFaces(font, context.fetch, buildCss2Url(endpoint, font), label),
		allowsDownload: (url) => allowsHost(url, downloadHosts),
	};
}

/**
 * @param {{downloadHosts?: string[]}} [options]
 * @returns {Provider}
 */
export function googleFonts({ downloadHosts = ["fonts.gstatic.com"] } = {}) {
	return css2Provider({
		id: "google-fonts",
		label: "Google Fonts",
		endpoint: "https://fonts.googleapis.com/css2",
		variable: true,
		note: null,
		downloadHosts,
	});
}

/**
 * Bunny mirrors the Google Fonts catalogue as static files, so a weight
 * range would be one file per weight step instead of one axis.
 *
 * @param {{downloadHosts?: string[]}} [options]
 * @returns {Provider}
 */
export function bunnyFonts({ downloadHosts = ["fonts.bunny.net", "cdn.jsdelivr.net"] } = {}) {
	return css2Provider({
		id: "bunny-fonts",
		label: "Bunny Fonts",
		endpoint: "https://fonts.bunny.net/css2",
		variable: false,
		note: "Bunny Fonts serves static files only, list the weights you need instead of a range.",
		downloadHosts,
	});
}
