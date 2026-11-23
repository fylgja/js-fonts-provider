// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { request } from "../http.js";
import { createFace, isSafeFace, mergeVariableFaces, sortFaces } from "./faces.js";

/** @typedef {import("./faces.js").Face} Face */
/** @typedef {import("../config.js").Family} Family */

/** These endpoints serve woff2 only to user agents they recognize as modern browsers. */
export const BROWSER_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FONT_FACE_REGEX = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
const SOURCE_REGEX = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/g;

/**
 * Picks the woff2 entry out of a `src` declaration.
 *
 * @param {string} src
 * @returns {string|null} absolute URL, null when there is no woff2
 */
export function pickWoff2(src) {
	for (const match of src.matchAll(SOURCE_REGEX)) {
		if (match[4] === "woff2") {
			return match[2].startsWith("//") ? `https:${match[2]}` : match[2];
		}
	}

	return null;
}

/**
 * Parses the `@font-face` rules of a stylesheet, keeping the ones with a woff2.
 *
 * @param {string} css
 * @param {boolean} [subsets] - read the subset from the comment above each rule
 * @returns {Face[]}
 */
export function parseFontFaces(css, subsets = true) {
	const faces = [];

	for (const match of css.matchAll(FONT_FACE_REGEX)) {
		const declarations = {};
		for (const declaration of match[2].split(";")) {
			const separator = declaration.indexOf(":");
			if (separator === -1) continue;
			declarations[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim();
		}

		const url = declarations.src ? pickWoff2(declarations.src) : null;
		if (url === null) continue;

		const comment = match[1] ?? "";
		const face = createFace({
			style: declarations["font-style"] ?? "normal",
			weight: declarations["font-weight"] ?? "400",
			family: declarations["font-family"]?.replace(/^['"]|['"]$/g, "") ?? null,
			stretch: declarations["font-stretch"] ?? null,
			subset: subsets ? (comment !== "" ? comment : "all") : null,
			unicodeRange: declarations["unicode-range"] ?? null,
			url,
		});

		if (isSafeFace(face)) faces.push(face);
	}

	return faces;
}

/**
 * Describes why an endpoint did not return the requested font. Google
 * answers with an HTML error page, Bunny with a CSS comment and a 200.
 *
 * @param {string} body
 * @returns {string} a hint, or an empty string when the body looks fine
 */
export function describeFailure(body) {
	const details = /Details:\s*([^*\n]+)/.exec(body)?.[1].trim();
	if (details) return details;

	const title = /<title>([^<]+)<\/title>/.exec(body)?.[1] ?? "";
	const requested = /Requested:\s*([^<]+)/.exec(body)?.[1].trim() ?? "";

	return [title, requested !== "" ? `Requested: ${requested}` : ""].filter(Boolean).join(" - ");
}

/**
 * Requests a stylesheet from a font endpoint and turns it into faces.
 *
 * @param {Family} font
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {string} label - the provider name, used in messages
 * @param {boolean} [subsets] - whether the endpoint serves subsets
 * @returns {Promise<Face[]>}
 */
export async function fetchFaces(font, fetcher, url, label, subsets = true) {
	const response = await request(fetcher, url, { "user-agent": BROWSER_USER_AGENT });
	const body = response.body.toString("utf8");
	const hint = describeFailure(body);
	const suffix = hint !== "" ? `: ${hint}` : ".";

	if (!response.ok) {
		throw new Error(`${label} rejected "${font.name}" (HTTP ${response.status})${suffix}\n${url}`);
	}

	const faces = parseFontFaces(body, subsets);
	if (faces.length === 0) {
		throw new Error(`${label} returned no woff2 files for "${font.name}"${suffix}\n${url}`);
	}

	if (!subsets) {
		return sortFaces(mergeVariableFaces(faces));
	}

	const wanted = faces.filter((face) => font.subsets.includes(face.subset));
	if (wanted.length === 0) {
		const available = [...new Set(faces.map((face) => face.subset))];
		throw new Error(`"${font.name}" has no ${font.subsets.join(", ")} subset. Available subsets: ${available.join(", ")}.`);
	}

	return sortFaces(mergeVariableFaces(wanted), font.subsets);
}
