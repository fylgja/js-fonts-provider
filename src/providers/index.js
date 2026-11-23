// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { bunnyFonts, googleFonts } from "./css2.js";
import { fontshare } from "./fontshare.js";
import { fontsource } from "./fontsource.js";
import { local } from "./local.js";

/**
 * A source of fonts.
 *
 * The capability flags are read during validation, so a config asking for
 * something a provider cannot do is refused before any request is made.
 * A provider returns faces and nothing else; downloading, naming and
 * rendering are the same for all of them.
 *
 * @typedef {object} Provider
 * @property {string} id - the `provider` value of a family
 * @property {string} label - human readable name, used in messages
 * @property {boolean} remote - whether resolving needs the network, only remote faces are downloaded
 * @property {boolean} subsets - whether the provider serves character subsets
 * @property {boolean} variable - whether the provider serves variable fonts, so a weight range is allowed
 * @property {string|null} note - extra guidance shown when a capability is missing
 * @property {(font: import("../config.js").Family, context: ResolveContext) => Promise<import("../api/faces.js").Face[]>} resolve
 *   - remote faces carry a `url`, local faces `files`; throws with a message for the user
 * @property {(url: string) => boolean} allowsDownload - whether a file URL it returned may be downloaded
 */

/**
 * @typedef {object} ResolveContext
 * @property {import("../storage.js").Storage} storage
 * @property {typeof fetch} fetch
 */

/**
 * @typedef {object} Providers
 * @property {string} defaultId - used when a family names no provider
 * @property {(id: string) => Provider|undefined} get
 * @property {() => string[]} ids
 */

/**
 * The built in providers. Adobe Fonts is deliberately absent, since its
 * license does not allow the font files to be self hosted.
 *
 * @returns {Provider[]}
 */
export function defaultProviders() {
	return [googleFonts(), bunnyFonts(), fontshare(), fontsource(), local()];
}

/**
 * Indexes providers by id. A later provider replaces an earlier one with the
 * same id, so a list can extend `defaultProviders()`.
 *
 * @param {Provider[]} providers
 * @param {string} [defaultId]
 * @returns {Providers}
 */
export function createProviders(providers, defaultId = "fontsource") {
	const byId = new Map(providers.map((provider) => [provider.id, provider]));

	return {
		defaultId,
		get: (id) => byId.get(id),
		ids: () => [...byId.keys()],
	};
}
