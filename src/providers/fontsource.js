// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { createFace, isSafeFace, mergeVariableFaces, sortFaces } from "../api/faces.js";
import { formatNumber, isNumeric } from "../format.js";
import { allowsHost, request } from "../http.js";
import { isRange } from "../weight.js";

/** @typedef {import("./index.js").Provider} Provider */

const API = "https://api.fontsource.org/v1";
const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";
const LABEL = "Fontsource";

/**
 * Builds the CDN URL of a single font file.
 *
 * @param {string} id
 * @param {string} subset
 * @param {string} style
 * @param {string|null} weight - null for a variable font
 * @returns {string}
 */
export function buildFontsourceUrl(id, subset, style, weight) {
	return weight === null
		? `${CDN}/${id}:vf@latest/${subset}-wght-${style}.woff2`
		: `${CDN}/${id}@latest/${subset}-${weight}-${style}.woff2`;
}

/**
 * Reads JSON from the Fontsource API.
 *
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {string} notFound - message thrown on a 404
 * @returns {Promise<Record<string, any>>}
 */
async function getJson(fetcher, url, notFound) {
	const response = await request(fetcher, url);

	if (response.status === 404) {
		throw new Error(notFound);
	}

	if (!response.ok) {
		throw new Error(`${LABEL} returned HTTP ${response.status} for ${url}.`);
	}

	let data;
	try {
		data = JSON.parse(response.body.toString("utf8"));
	} catch {
		throw new Error(`${LABEL} returned invalid JSON for ${url}.`);
	}

	return typeof data === "object" && data !== null ? data : {};
}

/**
 * Fontsource publishes its catalogue as metadata rather than a stylesheet,
 * so the faces are built from the API response instead of parsed from CSS.
 *
 * @param {{downloadHosts?: string[]}} [options]
 * @returns {Provider}
 */
export function fontsource({ downloadHosts = ["cdn.jsdelivr.net"] } = {}) {
	return {
		id: "fontsource",
		label: LABEL,
		remote: true,
		subsets: true,
		variable: true,
		note: null,
		async resolve(font, context) {
			const { id } = font;
			const meta = await getJson(
				context.fetch,
				`${API}/fonts/${id}`,
				`${LABEL} has no font with the id "${id}", derived from "${font.name}".\nSearch the catalogue at https://fontsource.org/`,
			);

			const list = (key) => (Array.isArray(meta[key]) ? meta[key] : []);
			const join = (values) => values.filter((value) => ["string", "number"].includes(typeof value)).join(", ");
			const metaSubsets = list("subsets");
			const metaStyles = list("styles");
			const metaWeights = list("weights");

			const missingSubsets = font.subsets.filter((subset) => !metaSubsets.map(String).includes(subset));
			if (missingSubsets.length) {
				throw new Error(`"${font.name}" has no ${missingSubsets.join(", ")} subset. Available subsets: ${join(metaSubsets)}.`);
			}

			const missingStyles = font.styles.filter((style) => !metaStyles.map(String).includes(style));
			if (missingStyles.length) {
				throw new Error(`"${font.name}" has no ${missingStyles.join(", ")} style. Available styles: ${join(metaStyles)}.`);
			}

			const ranges = font.weights.filter(isRange);
			if (ranges.length && !meta.variable) {
				throw new Error(`"${font.name}" is not a variable font, list the weights you need instead of a range. Available weights: ${join(metaWeights)}.`);
			}

			const available = metaWeights.map(String).filter(isNumeric).map(Number);
			const missingWeights = font.weights.filter((weight) => !isRange(weight) && !available.includes(Number(weight.api)));
			if (missingWeights.length) {
				throw new Error(`"${font.name}" has no ${missingWeights.map((weight) => weight.css).join(", ")} weight. Available weights: ${join(metaWeights)}.`);
			}

			// A variable file always covers the full axis, so the range it is
			// declared with comes from the font rather than from the config.
			let axis = null;
			if (ranges.length) {
				const variable = await getJson(context.fetch, `${API}/variable/${id}`, `${LABEL} has no variable metadata for "${id}".`);
				const { min, max } = variable.axes?.wght ?? {};
				if (!isNumeric(String(min)) || !isNumeric(String(max))) {
					throw new Error(`${LABEL} has no weight axis for "${id}".`);
				}
				axis = `${formatNumber(Number(min))} ${formatNumber(Number(max))}`;
			}

			const faces = [];
			for (const style of font.styles) {
				for (const weight of font.weights) {
					for (const subset of font.subsets) {
						const range = isRange(weight);
						const unicodeRange = meta.unicodeRange?.[subset];
						faces.push(createFace({
							style,
							weight: range ? axis : weight.css,
							family: typeof meta.family === "string" ? meta.family : null,
							subset,
							unicodeRange: typeof unicodeRange === "string" ? unicodeRange : null,
							url: buildFontsourceUrl(id, subset, style, range ? null : weight.api),
						}));
					}
				}
			}

			return sortFaces(mergeVariableFaces(faces).filter(isSafeFace), font.subsets);
		},
		allowsDownload: (url) => allowsHost(url, downloadHosts),
	};
}
