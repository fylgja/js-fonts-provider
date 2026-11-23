// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { createFace } from "../api/faces.js";

/** @typedef {import("./index.js").Provider} Provider */

/**
 * Fonts already in the fonts folder. There is nothing to request, so each
 * variant lists its own files.
 *
 * @returns {Provider}
 */
export function local() {
	return {
		id: "local",
		label: "Local",
		remote: false,
		subsets: false,
		variable: true,
		note: null,
		async resolve(font, context) {
			const missing = [];
			const faces = [];

			for (const variant of font.variants) {
				for (const file of variant.src) {
					if (!(await context.storage.exists(file))) missing.push(file);
				}

				faces.push(createFace({
					style: variant.style,
					weight: variant.weight.css,
					family: font.name,
					stretch: variant.stretch,
					display: variant.display,
					unicodeRange: variant.unicodeRange,
					files: variant.src,
				}));
			}

			if (missing.length) {
				throw new Error(`Missing font files for "${font.name}" in ${context.storage.location()}:\n  ${missing.join("\n  ")}`);
			}

			return faces;
		},
		allowsDownload: () => false,
	};
}
