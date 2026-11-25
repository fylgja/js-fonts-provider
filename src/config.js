// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { fontFormat, slugify } from "./format.js";
import { findOverlap, isInBounds, isRange, MAX_WEIGHT, MIN_WEIGHT, normalizeWeight, sortWeights } from "./weight.js";

/** @typedef {import("./weight.js").Weight} Weight */

/**
 * A face of the local provider, with its files relative to the fonts folder.
 *
 * @typedef {object} LocalVariant
 * @property {Weight} weight
 * @property {string} style
 * @property {string|null} stretch
 * @property {string|null} unicodeRange
 * @property {string} display
 * @property {string[]} src
 */

/**
 * A validated font family with every default filled in.
 *
 * @typedef {object} Family
 * @property {string} provider - provider id
 * @property {string} name
 * @property {string} cssVariable
 * @property {string|null} cssSelector - null uses the default selector
 * @property {boolean} preload
 * @property {boolean} adjustFallback
 * @property {string} slug - used in file names
 * @property {string} id - used by providers that address a family by id
 * @property {string} display
 * @property {string[]} fallbacks
 * @property {string[]} styles - empty for the local provider
 * @property {Weight[]} weights - empty for the local provider
 * @property {string[]} subsets - empty when the provider has no subsets
 * @property {LocalVariant[]} variants - only for the local provider
 */

/**
 * @typedef {object} NormalizedConfig
 * @property {Family[]} fonts - the valid families
 * @property {string[]} errors - one message per problem found
 * @property {boolean} valid
 */

export const DEFAULT_STYLES = ["normal"];
export const DEFAULT_WEIGHTS = ["400"];
export const DEFAULT_SUBSETS = ["latin"];
export const DEFAULT_DISPLAY = "swap";
export const DEFAULT_FALLBACKS = ["sans-serif"];
export const DISPLAY_VALUES = ["auto", "block", "swap", "fallback", "optional"];

/** Values a provider or variant puts in a declaration as is, such as `font-stretch` or `unicode-range`. */
export const SAFE_VALUE = /^[A-Za-z0-9 ,.%+?-]*$/;

export const MAX_SELECTOR_LENGTH = 200;

/** Completes the message for a weight out of bounds. */
const WEIGHT_BOUNDS = `not a weight from ${MIN_WEIGHT} to ${MAX_WEIGHT}, or a range from low to high.`;

/** Characters that would let a value break out of a CSS string or declaration. */
const UNSAFE = /["\\<>{};\x00-\x1f\x7f]/;

/**
 * Validates and normalizes a list of font families, without any request, so
 * a form can show every error before anything is fetched.
 *
 * @param {unknown} fonts
 * @param {import("./providers/index.js").Providers} providers
 * @returns {NormalizedConfig}
 */
export function normalizeFonts(fonts, providers) {
	if (!Array.isArray(fonts)) {
		return { fonts: [], errors: ["The fonts must be a list of font families."], valid: false };
	}

	const errors = [];
	const normalized = [];
	fonts.forEach((font, index) => {
		const family = normalizeFont(font, `fonts[${index}]`, errors, providers);
		if (family) normalized.push(family);
	});

	const seen = new Set();
	for (const family of normalized) {
		if (seen.has(family.cssVariable)) {
			errors.push(`Duplicate cssVariable "${family.cssVariable}", set a unique cssVariable for "${family.name}".`);
		}
		seen.add(family.cssVariable);
	}

	return { fonts: normalized, errors, valid: errors.length === 0 };
}

/**
 * Validates and fills in the defaults for a single family.
 *
 * @param {unknown} font
 * @param {string} label - used in error messages
 * @param {string[]} errors - collects the errors
 * @param {import("./providers/index.js").Providers} providers
 * @returns {Family|null} null when invalid
 */
function normalizeFont(font, label, errors, providers) {
	if (!isMap(font)) {
		errors.push(`${label} must be a set of options.`);
		return null;
	}

	const count = errors.length;
	const providerId = readString(font, "provider", label, errors) ?? providers.defaultId;
	const name = readString(font, "name", label, errors) ?? "";
	const cssVariable = readString(font, "cssVariable", label, errors) ?? "";
	const cssSelector = readString(font, "cssSelector", label, errors) ?? "";
	const id = readString(font, "id", label, errors) ?? "";
	const display = readString(font, "display", label, errors) ?? DEFAULT_DISPLAY;
	const fallbacks = orDefault(readStrings(font, "fallbacks", label, errors), DEFAULT_FALLBACKS);
	const preload = readBoolean(font, "preload", label, errors) ?? false;
	const adjustFallback = readBoolean(font, "adjustFallback", label, errors) ?? true;

	const provider = providers.get(providerId);
	if (!provider) {
		errors.push(`${label}.provider "${providerId}" is not supported, use one of: ${providers.ids().join(", ")}.`);
		return null;
	}

	if (name === "") {
		errors.push(`${label}.name is required.`);
	}

	const slug = slugify(name);
	const base = {
		provider: provider.id,
		name,
		cssVariable: cssVariable === ""
			? `--font-${slug}`
			: (cssVariable.startsWith("--") ? cssVariable : `--${cssVariable}`),
		cssSelector: cssSelector !== "" ? cssSelector : null,
		preload,
		adjustFallback,
		slug,
		// Providers that address a family by an id in a URL derive it from the
		// name, which `id` overrides for the rare family whose id differs.
		id: id !== "" ? id : slug,
		display,
		fallbacks,
		styles: [],
		weights: [],
		subsets: [],
		variants: [],
	};

	const family = provider.remote
		? normalizeRemote(font, label, base, provider, errors)
		: normalizeLocal(font, label, base, errors);

	if (!family || errors.length > count || !isSafe(family, label, errors)) {
		return null;
	}

	return family;
}

/**
 * Fills in the variants of the local provider.
 *
 * @param {Record<string, unknown>} font
 * @param {string} label
 * @param {Family} base - the shared family fields
 * @param {string[]} errors
 * @returns {Family|null}
 */
function normalizeLocal(font, label, base, errors) {
	const variants = font.variants ?? [];
	if (!Array.isArray(variants) || variants.length === 0) {
		errors.push(`${label}.variants is required for the "local" provider, and must list at least one variant.`);
		return null;
	}

	const normalized = [];
	variants.forEach((variant, index) => {
		const variantLabel = `${label}.variants[${index}]`;
		if (!isMap(variant)) {
			errors.push(`${variantLabel} must be a set of options.`);
			return;
		}

		const count = errors.length;
		const src = readStrings(variant, "src", variantLabel, errors) ?? [];
		const weight = readWeights(variant, "weight", variantLabel, errors)[0] ?? normalizeWeight(DEFAULT_WEIGHTS[0]);
		const style = readString(variant, "style", variantLabel, errors) ?? DEFAULT_STYLES[0];
		const stretch = readString(variant, "stretch", variantLabel, errors);
		const unicodeRange = readString(variant, "unicodeRange", variantLabel, errors);
		const display = readString(variant, "display", variantLabel, errors) ?? base.display;
		if (errors.length > count) return;

		if (src.length === 0) {
			errors.push(`${variantLabel}.src is required.`);
			return;
		}

		const unknown = src.filter((file) => fontFormat(file) === null);
		if (unknown.length) {
			errors.push(`${variantLabel}.src has files with an unknown font format: ${unknown.join(", ")}.`);
			return;
		}

		normalized.push({ weight, style, stretch, unicodeRange, display, src });
	});

	return normalized.length === variants.length ? { ...base, variants: normalized } : null;
}

/**
 * Fills in the styles, weights and subsets of a remote provider.
 *
 * @param {Record<string, unknown>} font
 * @param {string} label
 * @param {Family} base - the shared family fields
 * @param {import("./providers/index.js").Provider} provider
 * @param {string[]} errors
 * @returns {Family|null}
 */
function normalizeRemote(font, label, base, provider, errors) {
	const count = errors.length;
	const styles = orDefault(readStrings(font, "styles", label, errors), DEFAULT_STYLES);
	const read = readWeights(font, "weights", label, errors);
	const subsets = provider.subsets ? orDefault(readStrings(font, "subsets", label, errors), DEFAULT_SUBSETS) : [];
	if (errors.length > count) return null;

	const invalidStyles = styles.filter((style) => style !== "normal" && style !== "italic");
	if (invalidStyles.length) {
		errors.push(`${label}.styles only supports "normal" and "italic", received: ${invalidStyles.join(", ")}.`);
		return null;
	}

	const weights = sortWeights(read.length ? read : [normalizeWeight(DEFAULT_WEIGHTS[0])]);
	const overlap = findOverlap(weights);
	if (overlap) {
		errors.push(`${label}.weights lists "${overlap[1].css}" and "${overlap[0].css}", which cover the same weight. Use either the range or the single weights.`);
		return null;
	}

	const ranges = weights.filter(isRange);
	if (ranges.length && !provider.variable) {
		const list = ranges.map((weight) => `"${weight.css}"`).join(", ");
		errors.push(`${label}.weights uses the range ${list}, which ${provider.label} does not serve. ${provider.note ?? ""}`);
		return null;
	}

	return { ...base, styles: unique(styles), weights, subsets: unique(subsets) };
}

/**
 * Rejects values that would break out of a stylesheet, a file name or a URL.
 *
 * @param {Family} family
 * @param {string} label
 * @param {string[]} errors
 * @returns {boolean}
 */
function isSafe(family, label, errors) {
	const count = errors.length;

	if (UNSAFE.test(family.name)) {
		errors.push(`${label}.name contains characters that are not allowed in a font family name.`);
	}

	if (!/^--[A-Za-z0-9_-]+$/.test(family.cssVariable)) {
		errors.push(`${label}.cssVariable "${family.cssVariable}" is not a valid custom property name.`);
	}

	if (family.cssSelector !== null) {
		if (/[{};<>\\\x00-\x1f\x7f]|\/\*/.test(family.cssSelector)) {
			errors.push(`${label}.cssSelector contains characters that are not allowed in a selector.`);
		} else if (hasOpenQuote(family.cssSelector)) {
			errors.push(`${label}.cssSelector has a quote that is not closed.`);
		} else if ([...family.cssSelector].length > MAX_SELECTOR_LENGTH) {
			errors.push(`${label}.cssSelector is longer than ${MAX_SELECTOR_LENGTH} characters.`);
		}
	}

	if (!/^[A-Za-z0-9_-]*$/.test(family.id)) {
		errors.push(`${label}.id "${family.id}" may only contain letters, digits, "-" and "_".`);
	}

	if (!DISPLAY_VALUES.includes(family.display)) {
		errors.push(`${label}.display must be one of: ${DISPLAY_VALUES.join(", ")}.`);
	}

	for (const fallback of family.fallbacks) {
		if (!/^(?:[A-Za-z0-9 _-]+|"[A-Za-z0-9 _.-]+"|'[A-Za-z0-9 _.-]+')$/.test(fallback)) {
			errors.push(`${label}.fallbacks has a value that is not a font family name: ${fallback}.`);
		}
	}

	for (const weight of family.weights) {
		if (!/^\d+(?:\.\.\d+)?$/.test(weight.api)) {
			errors.push(`${label}.weights has "${weight.css}", which is not a number or a range of numbers.`);
		} else if (!isInBounds(weight)) {
			errors.push(`${label}.weights has "${weight.css}", which is ${WEIGHT_BOUNDS}`);
		}
	}

	for (const subset of family.subsets) {
		if (!/^[A-Za-z0-9_\-[\]]+$/.test(subset)) {
			errors.push(`${label}.subsets has "${subset}", which is not a valid subset name.`);
		}
	}

	family.variants.forEach((variant, index) => {
		const variantLabel = `${label}.variants[${index}]`;
		if (!/^\d+(?: \d+)?$/.test(variant.weight.css)) {
			errors.push(`${variantLabel}.weight "${variant.weight.css}" is not a number or a range of numbers.`);
		} else if (!isInBounds(variant.weight)) {
			errors.push(`${variantLabel}.weight "${variant.weight.css}" is ${WEIGHT_BOUNDS}`);
		}
		for (const key of ["style", "stretch", "unicodeRange"]) {
			if (variant[key] !== null && !SAFE_VALUE.test(variant[key])) {
				errors.push(`${variantLabel}.${key} contains characters that are not allowed.`);
			}
		}
		if (!DISPLAY_VALUES.includes(variant.display)) {
			errors.push(`${variantLabel}.display must be one of: ${DISPLAY_VALUES.join(", ")}.`);
		}
		for (const file of variant.src) {
			if (/["\\<>\x00-\x1f\x7f]/.test(file) || /(^|\/)\.\.(\/|$)/.test(file) || file.startsWith("/")) {
				errors.push(`${variantLabel}.src "${file}" must be a path inside the fonts folder.`);
			}
		}
	});

	return errors.length === count;
}

/**
 * Whether a selector ends inside a quoted string, such as an attribute value,
 * which would swallow the rest of the stylesheet.
 *
 * @param {string} selector - without backslashes, so a quote cannot be escaped
 * @returns {boolean}
 */
function hasOpenQuote(selector) {
	let quote = null;
	for (const char of selector) {
		if (quote === null && (char === '"' || char === "'")) {
			quote = char;
		} else if (char === quote) {
			quote = null;
		}
	}

	return quote !== null;
}

/**
 * Reads an optional string, trimmed.
 *
 * @param {Record<string, unknown>} options
 * @param {string} key
 * @param {string} label
 * @param {string[]} errors
 * @returns {string|null} null when absent
 */
function readString(options, key, label, errors) {
	const value = options[key] ?? null;
	if (value === null || typeof value === "string") {
		return value === null ? null : value.trim();
	}

	errors.push(`${label}.${key} must be a string.`);
	return null;
}

/**
 * Reads an optional list of strings, trimmed and without empty values.
 *
 * @param {Record<string, unknown>} options
 * @param {string} key
 * @param {string} label
 * @param {string[]} errors
 * @returns {string[]|null} null when absent
 */
function readStrings(options, key, label, errors) {
	const value = options[key] ?? null;
	if (value === null) return null;

	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
		errors.push(`${label}.${key} must be a list of strings.`);
		return null;
	}

	return value.map((item) => item.trim()).filter((item) => item !== "");
}

/**
 * Reads an optional weight or list of weights, each a number or a range.
 *
 * @param {Record<string, unknown>} options
 * @param {string} key
 * @param {string} label
 * @param {string[]} errors
 * @returns {Weight[]}
 */
function readWeights(options, key, label, errors) {
	const value = options[key] ?? [];
	const list = Array.isArray(value) ? value : [value];

	if (!list.every((item) => Number.isInteger(item) || typeof item === "string")) {
		errors.push(`${label}.${key} must be a number, a range such as "100 900", or a list of those.`);
		return [];
	}

	return list.map(normalizeWeight);
}

/**
 * Reads an optional boolean.
 *
 * @param {Record<string, unknown>} options
 * @param {string} key
 * @param {string} label
 * @param {string[]} errors
 * @returns {boolean|null} null when absent
 */
function readBoolean(options, key, label, errors) {
	const value = options[key] ?? null;
	if (value === null || typeof value === "boolean") return value;

	errors.push(`${label}.${key} must be true or false.`);
	return null;
}

/**
 * @param {string[]|null} list
 * @param {string[]} fallback
 * @returns {string[]}
 */
function orDefault(list, fallback) {
	return list?.length ? list : fallback;
}

/**
 * @param {string[]} list
 * @returns {string[]}
 */
function unique(list) {
	return [...new Set(list)];
}

/**
 * Whether a value is an object of named options rather than a list.
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isMap(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
