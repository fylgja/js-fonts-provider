// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { fontFormat, mimeType } from "./format.js";

/** @typedef {import("./api/faces.js").Face} Face */
/** @typedef {import("./fallback.js").FallbackFace} FallbackFace */
/** @typedef {import("./result.js").ResolvedFamily} ResolvedFamily */

/**
 * A font file to preload.
 *
 * @typedef {object} Preload
 * @property {string} family - the family name
 * @property {string} file - relative to the fonts folder
 * @property {string} url - `file` prefixed with the URL base
 * @property {string} type - media type, such as "font/woff2"
 */

/**
 * Quotes a font family name for use in CSS.
 *
 * @param {string} family
 * @returns {string}
 */
export function quoteFamily(family) {
	return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(family) ? family : `"${family}"`;
}

/**
 * The value of a family's CSS variable: the family, its fallback face when
 * there is one, and the configured fallbacks.
 *
 * @param {ResolvedFamily} family
 * @returns {string}
 */
export function fontStack(family) {
	return [
		quoteFamily(family.font.name),
		...(family.fallbackFace ? [quoteFamily(family.fallbackFace.family)] : []),
		...family.font.fallbacks,
	].join(", ");
}

/**
 * Every file of every face of a family, without duplicates.
 *
 * @param {ResolvedFamily} family
 * @returns {string[]}
 */
export function familyFiles(family) {
	return [...new Set(family.faces.flatMap((face) => face.files))];
}

/**
 * @param {string[]} declarations
 * @returns {string}
 */
function rule(declarations) {
	return `@font-face {\n${declarations.map((line) => `    ${line};`).join("\n")}\n}`;
}

/**
 * Renders a single `@font-face` rule.
 *
 * @param {Face} face - with `files` as URLs
 * @returns {string}
 */
export function renderFontFace(face) {
	const src = face.files
		.map((file) => {
			const format = fontFormat(file);
			return `url("${file}")${format !== null ? ` format("${format}")` : ""}`;
		})
		.join(",\n         ");

	return rule([
		`font-family: ${quoteFamily(face.family ?? "")}`,
		`font-style: ${face.style}`,
		`font-weight: ${face.weight}`,
		face.stretch ? `font-stretch: ${face.stretch}` : null,
		face.display ? `font-display: ${face.display}` : null,
		`src: ${src}`,
		face.unicodeRange ? `unicode-range: ${face.unicodeRange}` : null,
	].filter((line) => line !== null));
}

/**
 * Renders the face that adjusts a local font to the metrics of the webfont.
 *
 * @param {FallbackFace} face
 * @returns {string}
 */
export function renderFallbackFace(face) {
	return rule([
		`font-family: ${quoteFamily(face.family)}`,
		`src: ${face.local.map((name) => `local("${name}")`).join(", ")}`,
		`size-adjust: ${face.sizeAdjust}`,
		`ascent-override: ${face.ascentOverride}`,
		`descent-override: ${face.descentOverride}`,
		`line-gap-override: ${face.lineGapOverride}`,
	]);
}

/**
 * Renders every `@font-face` rule, the faces of each family followed by its
 * fallback face.
 *
 * @param {ResolvedFamily[]} families
 * @param {string} urlBase - path or URL of the fonts folder
 * @returns {string}
 */
export function renderFontFaces(families, urlBase) {
	const rules = [];

	for (const family of families) {
		for (const face of family.faces) {
			// The configured name and font-display always win, so every
			// provider behaves the same, and the family in the @font-face
			// can never drift from the one the CSS variable refers to.
			rules.push(renderFontFace({
				...face,
				family: family.font.name,
				display: face.display ?? family.font.display,
				files: face.files.map((file) => `${urlBase}/${file}`),
			}));
		}

		if (family.fallbackFace) {
			rules.push(renderFallbackFace(family.fallbackFace));
		}
	}

	return rules.join("\n\n");
}

/**
 * Renders a block per selector, exposing every family as a CSS variable.
 *
 * @param {ResolvedFamily[]} families
 * @param {string} cssSelector - for families that do not name one themselves
 * @returns {string}
 */
export function renderVariables(families, cssSelector) {
	const groups = new Map();
	for (const family of families) {
		const selector = family.font.cssSelector ?? cssSelector;
		groups.set(selector, [...(groups.get(selector) ?? []), family]);
	}

	return [...groups]
		.map(([selector, group]) => {
			const declarations = group.map((family) => `    ${family.font.cssVariable}: ${fontStack(family)};`);
			return `${selector} {\n${declarations.join("\n")}\n}`;
		})
		.join("\n\n");
}

/**
 * Lists the files of every family that asked to be preloaded.
 *
 * @param {ResolvedFamily[]} families
 * @param {string} urlBase
 * @returns {Preload[]}
 */
export function listPreloads(families, urlBase) {
	return families
		.filter((family) => family.font.preload)
		.flatMap((family) => familyFiles(family).map((file) => ({
			family: family.font.name,
			file,
			url: `${urlBase}/${file}`,
			type: mimeType(file) ?? "font/woff2",
		})));
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

/**
 * Renders preload links for the head of a page.
 *
 * @param {Preload[]} preloads
 * @returns {string} one link per line
 */
export function renderPreloads(preloads) {
	return preloads
		.map((preload) => `<link rel="preload" as="font" type="${escapeHtml(preload.type)}" href="${escapeHtml(preload.url)}" crossorigin>`)
		.join("\n");
}
