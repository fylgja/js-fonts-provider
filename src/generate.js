// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { normalizeFonts } from "./config.js";
import { buildFallbackFace, pickFallback } from "./fallback.js";
import { extension, isFontFile } from "./format.js";
import { createFetch, request } from "./http.js";
import { readMetrics } from "./metrics.js";
import { createProviders, defaultProviders } from "./providers/index.js";
import { ConfigError, Result, WarningError } from "./result.js";
import { localStorage } from "./storage.js";

/** @typedef {import("./config.js").Family} Family */
/** @typedef {import("./api/faces.js").Face} Face */
/** @typedef {import("./providers/index.js").Provider} Provider */
/** @typedef {import("./result.js").Download} Download */

/**
 * @typedef {object} Options
 * @property {string|import("./storage.js").Storage} [storage] - the fonts folder, a path or a storage
 * @property {string} [urlBase] - path or URL of the fonts folder, as the page sees it
 * @property {string} [cssSelector] - selector for families that do not name one
 * @property {boolean} [force] - download every file again, even when it is present
 * @property {boolean} [strict] - throw a `WarningError` when there are warnings
 * @property {number} [maxFileSize] - a larger font file is refused
 * @property {number} [maxFiles] - font files downloaded in one run
 * @property {number} [maxTotalBytes] - bytes of the font files downloaded in one run
 * @property {boolean} [allowPrivateAddresses] - also request hosts with private, loopback and other non public addresses
 * @property {Provider[]} [providers] - defaults to `defaultProviders()`
 * @property {typeof fetch|null} [fetch] - such as one for a proxy, defaults to a `node:https` client
 */

/**
 * Validates the families without any request, to show errors on a form.
 *
 * @param {unknown} fonts
 * @param {{providers?: Provider[]}} [options]
 * @returns {import("./config.js").NormalizedConfig}
 */
export function normalize(fonts, { providers = defaultProviders() } = {}) {
	return normalizeFonts(fonts, createProviders(providers));
}

/**
 * Resolves every family, downloads the files that are missing and measures
 * each family for its fallback face.
 *
 * A family that cannot be resolved is left without faces, with a warning,
 * so the rest still works.
 *
 * @param {unknown} fonts
 * @param {Options} [options]
 * @returns {Promise<Result>}
 * @throws {ConfigError} when the families are invalid, before any request
 * @throws {WarningError} in strict mode, when there are warnings
 */
export async function generate(fonts, {
	storage = "fonts",
	urlBase = "/fonts",
	cssSelector = ":root",
	force = false,
	strict = false,
	maxFileSize = 10 * 1024 * 1024,
	maxFiles = 500,
	maxTotalBytes = 100 * 1024 * 1024,
	allowPrivateAddresses = false,
	providers = defaultProviders(),
	fetch = null,
} = {}) {
	const registry = createProviders(providers);
	const config = normalizeFonts(fonts, registry);
	if (!config.valid) {
		throw new ConfigError(config.errors);
	}

	const context = {
		storage: typeof storage === "string" ? localStorage(storage) : storage,
		fetch: createFetch(fetch, allowPrivateAddresses),
	};
	const warnings = [];

	const settled = await Promise.allSettled(config.fonts.map((font) => registry.get(font.provider).resolve(font, context)));
	const resolved = settled.map((outcome, index) => {
		if (outcome.status === "fulfilled") return outcome.value;

		warnings.push(`Skipped "${config.fonts[index].name}", it could not be resolved.\n  ${outcome.reason?.message}`);
		return [];
	});

	// A variable font serves one file for every weight, so the same URL
	// must map to a single local file instead of one copy per face. Two URLs
	// mapping to the same name would overwrite each other instead.
	const filesByUrl = new Map();
	const urlsByFile = new Map();
	const downloads = [];
	const families = config.fonts.map((font, index) => {
		const provider = registry.get(font.provider);
		if (!provider.remote) return { font, faces: resolved[index] };

		const faces = resolved[index].flatMap((face) => {
			if (!filesByUrl.has(face.url)) {
				const file = downloadFileName(font, face);
				if (urlsByFile.has(file)) {
					warnings.push(`Skipped ${face.url} for "${font.name}", its file name ${file} is taken by ${urlsByFile.get(file)}.`);
					return [];
				}
				filesByUrl.set(face.url, file);
				urlsByFile.set(file, face.url);
				downloads.push({ url: face.url, file, provider });
			}
			return [{ ...face, files: [filesByUrl.get(face.url)] }];
		});

		return { font, faces };
	});

	// Files are counted in the order of the config, before any request, so
	// which file goes over `maxFiles` does not depend on timing.
	const present = await Promise.all(downloads.map(({ file }) => !force && context.storage.exists(file)));
	const budget = { files: 0, bytes: 0, maxFiles, maxTotalBytes };
	const records = await Promise.all(downloads.map(({ url, file, provider }, index) => {
		if (present[index]) return { url, file, status: "present", error: null };
		if (++budget.files > maxFiles) return { url, file, status: "failed", error: `the run reached its limit of ${maxFiles} font files` };

		return downloadFile({ url, file, provider }, context, { maxFileSize, budget });
	}));
	const failed = new Map(records.filter((record) => record.status === "failed").map((record) => [record.file, `${record.url} (${record.error})`]));

	const result = [];
	for (const { font, faces: resolvedFaces } of families) {
		let faces = resolvedFaces;

		// Faces whose file never arrived are dropped rather than left pointing
		// at a URL that is not there, which would only surface as a 404.
		const missing = new Map();
		for (const file of faces.flatMap((face) => face.files)) {
			if (failed.has(file)) missing.set(file, failed.get(file));
		}

		if (missing.size) {
			faces = faces.filter((face) => !face.files.some((file) => missing.has(file)));
			warnings.push(`Could not download ${missing.size} font file(s) for "${font.name}".\n  ${[...new Set(missing.values())].join("\n  ")}`);
		}

		let metrics = null;
		let fallbackFace = null;
		if (font.adjustFallback && faces.length && pickFallback(font.fallbacks) !== null) {
			const bytes = faces[0].files[0] !== undefined ? await context.storage.read(faces[0].files[0]) : null;
			metrics = bytes !== null ? readMetrics(bytes) : null;
			if (metrics !== null) {
				fallbackFace = buildFallbackFace(font.name, font.fallbacks, metrics);
			} else if (bytes !== null) {
				warnings.push(`Could not measure "${font.name}" for its fallback face.`);
			}
		}

		result.push({ font, faces, fallbackFace, metrics });
	}

	const output = new Result(
		result,
		{ urlBase, cssSelector },
		records.map(({ url, file, status, error }) => ({ url, file, status, error })),
		warnings,
	);

	if (strict && warnings.length) {
		throw new WarningError(output);
	}

	return output;
}

/**
 * Builds the name a downloaded file is stored under.
 *
 * @param {Family} font
 * @param {Face} face
 * @returns {string}
 */
export function downloadFileName(font, face) {
	const weight = face.weight.trim().replace(/\s+/g, "-");
	const parts = [font.slug, face.subset, weight, face.style].filter((part) => part !== null && part !== "");

	// Google serves some families from a URL without an extension, and only
	// woff2 files are ever downloaded.
	const url = face.url ?? "";

	return `${parts.join("-")}.${isFontFile(url) ? extension(url) : "woff2"}`;
}

/**
 * Downloads and stores a single file, reporting a failure instead of
 * throwing so one unreachable file cannot take the whole stylesheet down.
 *
 * @param {{url: string, file: string, provider: Provider}} download
 * @param {import("./providers/index.js").ResolveContext} context
 * @param {{maxFileSize: number, budget: {bytes: number, maxTotalBytes: number}}} options
 * @returns {Promise<Download>}
 */
async function downloadFile({ url, file, provider }, context, { maxFileSize, budget }) {
	const fail = (error) => ({ url, file, status: "failed", error });

	if (!provider.allowsDownload(url)) {
		return fail("not a host this provider serves fonts from");
	}

	try {
		const response = await request(context.fetch, url);

		if (!response.ok) return fail(`HTTP ${response.status}`);
		if (response.body.length > maxFileSize) return fail(`larger than ${maxFileSize} bytes`);
		budget.bytes += response.body.length;
		if (budget.bytes > budget.maxTotalBytes) return fail(`the run reached its limit of ${budget.maxTotalBytes} bytes`);
		if (extension(file) === "woff2" && response.body.toString("latin1", 0, 4) !== "wOF2") {
			return fail("not a woff2 file");
		}

		await context.storage.write(file, response.body);
	} catch (error) {
		return fail(error.message);
	}

	return { url, file, status: "downloaded", error: null };
}
