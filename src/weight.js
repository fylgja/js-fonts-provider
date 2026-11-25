// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { toFloat } from "./format.js";

/**
 * A weight in the three spellings it is needed in: the CSS2 API ("300..700"),
 * the generated CSS ("300 700") and file names ("300-700").
 *
 * @typedef {object} Weight
 * @property {string} api
 * @property {string} css
 * @property {string} slug
 */

/** The lowest and highest weight CSS accepts. */
export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 1000;

/**
 * Normalizes a weight. A range like "300 700", "300..700" or "300-700"
 * describes a variable font axis. A value with more than two parts is kept
 * as is, so validation refuses it instead of dropping a part.
 *
 * @param {number|string} weight
 * @returns {Weight}
 */
export function normalizeWeight(weight) {
	const value = String(weight).trim();
	const range = value.split(/\s*(?:\.\.|\s|-)\s*/).filter(Boolean);

	if (range.length === 2) {
		return {
			api: `${range[0]}..${range[1]}`,
			css: `${range[0]} ${range[1]}`,
			slug: `${range[0]}-${range[1]}`,
		};
	}

	return { api: value, css: value, slug: value };
}

/**
 * Whether a weight lies within the weights CSS accepts, with the lowest
 * weight of a range first.
 *
 * @param {Weight} weight
 * @returns {boolean}
 */
export function isInBounds(weight) {
	const [min, max] = bounds(weight);

	return min >= MIN_WEIGHT && max <= MAX_WEIGHT && (min < max || !isRange(weight));
}

/**
 * Whether a weight is a variable range.
 *
 * @param {Weight} weight
 * @returns {boolean}
 */
export function isRange(weight) {
	return weight.css.includes(" ");
}

/**
 * The lowest and highest weight a weight covers.
 *
 * @param {Weight} weight
 * @returns {[number, number]}
 */
export function bounds(weight) {
	const parts = weight.api.split("..").map(toFloat);

	return [parts[0], parts[1] ?? parts[0]];
}

/**
 * Sorts weights numerically and drops exact duplicates, since the CSS2 API
 * requires axis values in ascending order and rejects a repeated one.
 *
 * @param {Weight[]} weights
 * @returns {Weight[]}
 */
export function sortWeights(weights) {
	const unique = [...new Map(weights.map((weight) => [weight.api, weight])).values()];

	return unique.sort((a, b) => {
		const [aMin, aMax] = bounds(a);
		const [bMin, bMax] = bounds(b);

		return Math.sign(aMin - bMin) || Math.sign(aMax - bMax);
	});
}

/**
 * Finds a weight that falls inside the weight before it, such as "400"
 * next to "300 700", which would produce two competing `@font-face` rules.
 *
 * @param {Weight[]} weights - sorted, unique weights
 * @returns {[Weight, Weight]|null} the overlapping pair
 */
export function findOverlap(weights) {
	for (let i = 1; i < weights.length; i++) {
		if (bounds(weights[i])[0] <= bounds(weights[i - 1])[1]) {
			return [weights[i - 1], weights[i]];
		}
	}

	return null;
}
