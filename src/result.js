// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { fontStack, listPreloads, renderFontFaces, renderPreloads, renderVariables } from "./render.js";

/**
 * A family with the faces it resolved to. A family without faces could not be
 * resolved, its CSS variable is still declared so the stylesheet stays valid.
 *
 * @typedef {object} ResolvedFamily
 * @property {import("./config.js").Family} font
 * @property {import("./api/faces.js").Face[]} faces - with `files` relative to the fonts folder
 * @property {import("./fallback.js").FallbackFace|null} fallbackFace
 * @property {import("./metrics.js").Metrics|null} metrics - of the first file, when measured
 */

/**
 * A font file this run needed.
 *
 * @typedef {object} Download
 * @property {string} url
 * @property {string} file - relative to the fonts folder
 * @property {"downloaded"|"present"|"failed"} status
 * @property {string|null} error - why it failed
 */

/** What a run resolved, downloaded and measured, and the CSS for it. */
export class Result {
	/**
	 * @param {ResolvedFamily[]} families
	 * @param {{urlBase: string, cssSelector: string}} options
	 * @param {Download[]} downloads
	 * @param {string[]} warnings
	 */
	constructor(families, options, downloads = [], warnings = []) {
		/** @type {ResolvedFamily[]} */
		this.families = families;
		/** @type {Download[]} */
		this.downloads = downloads;
		/** @type {string[]} */
		this.warnings = warnings;
		this.options = options;
	}

	/**
	 * The `@font-face` rules followed by the CSS variables.
	 *
	 * @returns {string}
	 */
	css() {
		return `${this.fontFaceCss()}\n\n${this.variablesCss()}`.trim();
	}

	/**
	 * Only the `@font-face` rules, the faces and the fallback faces.
	 *
	 * @returns {string}
	 */
	fontFaceCss() {
		return renderFontFaces(this.families, this.options.urlBase);
	}

	/**
	 * Only the selector blocks declaring the CSS variables.
	 *
	 * @returns {string}
	 */
	variablesCss() {
		return renderVariables(this.families, this.options.cssSelector);
	}

	/**
	 * The value of each family's CSS variable, for a caller that declares the
	 * variables itself, such as a design tokens module.
	 *
	 * @returns {Record<string, string>} font stacks keyed by CSS variable name
	 */
	variables() {
		return Object.fromEntries(this.families.map((family) => [family.font.cssVariable, fontStack(family)]));
	}

	/**
	 * The files of every family with `preload` set.
	 *
	 * @returns {import("./render.js").Preload[]}
	 */
	preloads() {
		return listPreloads(this.families, this.options.urlBase);
	}

	/**
	 * Preload links for the head of a page.
	 *
	 * @returns {string}
	 */
	preloadHtml() {
		return renderPreloads(this.preloads());
	}

	/**
	 * The number of files downloaded in this run.
	 *
	 * @returns {number}
	 */
	downloaded() {
		return this.downloads.filter((download) => download.status === "downloaded").length;
	}
}

/** Thrown when the families are invalid, before any request. */
export class ConfigError extends Error {
	/**
	 * @param {string[]} errors - one message per problem found
	 */
	constructor(errors) {
		super(`Invalid "fonts" configuration:\n  ${errors.join("\n  ")}`);
		this.name = "ConfigError";
		this.errors = errors;
	}
}

/**
 * Thrown in strict mode when a run had warnings. The files are already
 * written, the result is attached.
 */
export class WarningError extends Error {
	/**
	 * @param {Result} result
	 */
	constructor(result) {
		super(`The fonts were generated with ${result.warnings.length} warning(s).\n  ${result.warnings.join("\n  ")}`);
		this.name = "WarningError";
		this.result = result;
	}
}
