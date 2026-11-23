// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { parseWeights } from "../api/faces.js";
import { fetchFaces } from "../api/stylesheet.js";
import { formatNumber } from "../format.js";
import { allowsHost } from "../http.js";

/** @typedef {import("./index.js").Provider} Provider */
/** @typedef {import("../config.js").Family} Family */
/** @typedef {import("../api/faces.js").Face} Face */

const ENDPOINT = "https://api.fontshare.com/v2/css";
const LABEL = "Fontshare";

/**
 * Builds the request URL. Fontshare identifies a variant by a number where
 * the italic of a weight is that weight plus one, so 401 is italic 400.
 *
 * @param {Family} font
 * @returns {string}
 */
export function buildFontshareUrl(font) {
	const variants = font.styles.flatMap((style) =>
		font.weights.map((weight) => Number.parseInt(weight.api, 10) + (style === "italic" ? 1 : 0)),
	);

	return `${ENDPOINT}?f[]=${font.id}@${[...new Set(variants)].sort((a, b) => a - b).join(",")}`;
}

/**
 * Fontshare drops variants it does not have instead of failing, so the
 * response is checked against what was asked for.
 *
 * @param {Family} font
 * @param {Face[]} faces
 * @returns {void}
 */
function assertComplete(font, faces) {
	const found = new Set(faces.map((face) => `${formatNumber(parseWeights(face.weight)[0] ?? 0)}-${face.style}`));
	const missing = font.styles.flatMap((style) =>
		font.weights
			.filter((weight) => !found.has(`${weight.api}-${style}`))
			.map((weight) => `${weight.css} ${style}`),
	);

	if (missing.length) {
		throw new Error(`${LABEL} has no ${missing.join(", ")} for "${font.name}".\n${buildFontshareUrl(font)}`);
	}
}

/**
 * Fontshare serves one static file per family covering every character it has.
 *
 * @param {{downloadHosts?: string[]}} [options]
 * @returns {Provider}
 */
export function fontshare({ downloadHosts = ["cdn.fontshare.com"] } = {}) {
	return {
		id: "fontshare",
		label: LABEL,
		remote: true,
		subsets: false,
		variable: false,
		note: "Fontshare serves static files only, list the weights you need instead of a range.",
		async resolve(font, context) {
			const faces = await fetchFaces(font, context.fetch, buildFontshareUrl(font), LABEL, false);
			assertComplete(font, faces);

			return faces;
		},
		allowsDownload: (url) => allowsHost(url, downloadHosts),
	};
}
