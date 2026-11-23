// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

const EXTENSIONS = ["woff2", "woff", "ttf", "otf", "eot", "svg"];

const FORMATS = {
	woff2: "woff2",
	woff: "woff",
	ttf: "truetype",
	otf: "opentype",
	eot: "embedded-opentype",
	svg: "svg",
};

const MIME_TYPES = {
	woff2: "font/woff2",
	woff: "font/woff",
	ttf: "font/ttf",
	otf: "font/otf",
	eot: "application/vnd.ms-fontobject",
	svg: "image/svg+xml",
};

/**
 * Prints a number for CSS or a URL, without a trailing ".0" and with at
 * most four decimals.
 *
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(value) {
	const printed = value.toFixed(4).replace(/\.?0+$/, "");

	return printed === "-0" ? "0" : printed;
}

/**
 * Prints a ratio as a percentage with two decimals, such as "92.43%".
 *
 * @param {number} ratio
 * @returns {string}
 */
export function formatPercent(ratio) {
	return `${formatNumber(Math.round(ratio * 10000) / 100)}%`;
}

/**
 * Reads the lowercase extension of a file name, path or URL.
 *
 * @param {string} file
 * @returns {string}
 */
export function extension(file) {
	return file.split("?", 1)[0].split(".").pop().toLowerCase();
}

/**
 * Whether a file name ends in a font extension.
 *
 * @param {string} file
 * @returns {boolean}
 */
export function isFontFile(file) {
	return EXTENSIONS.includes(extension(file));
}

/**
 * Looks up the CSS `format()` hint for a font file.
 *
 * @param {string} file - file name, path or URL
 * @returns {string|null} null when the extension is unknown
 */
export function fontFormat(file) {
	return FORMATS[extension(file)] ?? null;
}

/**
 * Looks up the media type for a font file, as used in a preload link.
 *
 * @param {string} file
 * @returns {string|null} null when the extension is unknown
 */
export function mimeType(file) {
	return MIME_TYPES[extension(file)] ?? null;
}

/**
 * Whether a string is a plain decimal number, such as "400" or "-1.5e2".
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isNumeric(value) {
	return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
}

/**
 * Reads the leading number of a string, 0 when there is none.
 *
 * @param {string} value
 * @returns {number}
 */
export function toFloat(value) {
	const number = Number.parseFloat(value);

	return Number.isNaN(number) ? 0 : number;
}

/**
 * Turns a font family name into a lowercase, dash separated slug.
 *
 * Words are only split on the separators already in the name, so
 * "JetBrains Mono" stays "jetbrains-mono", the way the catalogues spell
 * their ids.
 *
 * @param {string} value
 * @returns {string}
 */
export function slugify(value) {
	return value
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
