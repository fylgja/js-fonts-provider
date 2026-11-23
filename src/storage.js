// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * The fonts folder. Every path is relative to it and uses "/", such as
 * "inter-latin-400-normal.woff2".
 *
 * @typedef {object} Storage
 * @property {(path: string) => Promise<boolean>} exists - false as well for a path outside the folder
 * @property {(path: string) => Promise<Buffer|null>} read - null when the file does not exist
 * @property {(path: string, contents: Buffer) => Promise<void>} write - creates the folder when needed
 * @property {() => string} location - describes the folder in messages, such as its absolute path
 */

/**
 * A fonts folder on the local filesystem.
 *
 * @param {string} root - path to the fonts folder, created when needed
 * @returns {Storage}
 */
export function localStorage(root) {
	const base = path.resolve(root);

	/**
	 * Turns a relative path into an absolute one, refusing anything that
	 * would leave the fonts folder.
	 *
	 * @param {string} file
	 * @returns {string|null} null when the path is not inside the folder
	 */
	const resolve = (file) => {
		const normalized = file.replaceAll("\\", "/");
		if (normalized.startsWith("/") || normalized.includes("\0") || /^[a-z]:/i.test(normalized)) {
			return null;
		}

		const segments = normalized.split("/").filter((segment) => segment !== "" && segment !== ".");
		if (segments.includes("..")) return null;

		return path.join(base, ...segments);
	};

	const isFile = async (file) => (await fs.stat(file).catch(() => null))?.isFile() ?? false;

	return {
		async exists(file) {
			const target = resolve(file);
			return target !== null && (await isFile(target));
		},
		async read(file) {
			const target = resolve(file);
			return target !== null && (await isFile(target)) ? fs.readFile(target) : null;
		},
		async write(file, contents) {
			const target = resolve(file);
			if (target === null) {
				throw new Error(`"${file}" is not inside the fonts folder.`);
			}

			await fs.mkdir(path.dirname(target), { recursive: true });
			// Written next to the target and renamed, so a reader never sees half a file.
			const temporary = `${target}.${randomBytes(4).toString("hex")}.tmp`;
			try {
				await fs.writeFile(temporary, contents);
				await fs.rename(temporary, target);
			} catch (error) {
				await fs.rm(temporary, { force: true });
				throw error;
			}
		},
		location: () => base,
	};
}
