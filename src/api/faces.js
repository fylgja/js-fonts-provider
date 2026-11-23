// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { SAFE_VALUE } from "../config.js";
import { formatNumber, isNumeric } from "../format.js";

/**
 * A single `@font-face`, as a provider resolved it.
 *
 * @typedef {object} Face
 * @property {string} style
 * @property {string} weight - a single weight or a "min max" range
 * @property {string|null} family
 * @property {string|null} stretch
 * @property {string|null} display
 * @property {string|null} subset
 * @property {string|null} unicodeRange
 * @property {string|null} url - remote file, absent for a local face
 * @property {string[]} files - relative to the fonts folder
 */

/**
 * Builds a face with every optional field set to null.
 *
 * @param {Partial<Face> & {style: string, weight: string}} fields
 * @returns {Face}
 */
export function createFace(fields) {
	return {
		family: null,
		stretch: null,
		display: null,
		subset: null,
		unicodeRange: null,
		url: null,
		files: [],
		...fields,
	};
}

/**
 * Reads the numeric weights out of a `font-weight` value, a single weight
 * ("400") or a variable range ("400 900").
 *
 * @param {string} value
 * @returns {number[]}
 */
export function parseWeights(value) {
	return value.trim().split(/\s+/).filter(isNumeric).map(Number);
}

/**
 * Collapses the faces of a variable font.
 *
 * A variable font is served as one file per subset and style covering the
 * whole weight axis, so a request for several weights returns the same URL
 * over and over. Those faces are merged into one rule spanning the range.
 *
 * @param {Face[]} faces
 * @returns {Face[]}
 */
export function mergeVariableFaces(faces) {
	const merged = new Map();

	for (const face of faces) {
		const key = `${face.url}|${face.style}`;
		const entry = merged.get(key) ?? { face, weights: [] };
		entry.weights.push(...parseWeights(face.weight));
		merged.set(key, entry);
	}

	return [...merged.values()].map(({ face, weights }) => {
		const min = Math.min(...weights);
		const max = Math.max(...weights);
		const weight = min === max ? formatNumber(min) : `${formatNumber(min)} ${formatNumber(max)}`;

		return { ...face, weight };
	});
}

/**
 * Sorts faces so the stylesheet reads top down: upright before italic,
 * light before bold, subsets in the configured order.
 *
 * @param {Face[]} faces
 * @param {string[]} [subsets] - subsets in configuration order
 * @returns {Face[]}
 */
export function sortFaces(faces, subsets = []) {
	const index = (subset) => (subset === null ? -1 : subsets.indexOf(subset));

	return [...faces].sort((a, b) => {
		const italic = Number(a.style === "italic") - Number(b.style === "italic");
		if (italic) return italic;

		const weight = Math.sign((parseWeights(a.weight)[0] ?? 0) - (parseWeights(b.weight)[0] ?? 0));
		if (weight) return weight;

		return Math.sign(index(a.subset) - index(b.subset));
	});
}

/**
 * Whether a face only holds values that are safe to print in a stylesheet
 * and a file name. A face that fails is dropped.
 *
 * @param {Face} face
 * @returns {boolean}
 */
export function isSafeFace(face) {
	const values = [face.style, face.weight, face.stretch, face.unicodeRange];
	if (values.some((value) => value !== null && !SAFE_VALUE.test(value))) {
		return false;
	}

	return face.subset === null || /^[A-Za-z0-9_\-[\]]+$/.test(face.subset);
}
