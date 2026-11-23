// Fylgja (https://fylgja.dev)
// Licensed under MIT Open Source

import { brotliDecompressSync, inflateSync } from "node:zlib";

/**
 * The vertical metrics and average character width of a font, in font units.
 *
 * @typedef {object} Metrics
 * @property {number} unitsPerEm
 * @property {number} ascent
 * @property {number} descent - negative below the baseline
 * @property {number} lineGap
 * @property {number} xWidthAvg - English letter frequency weighted average advance
 */

/** The 63 tags a woff2 table directory can refer to by index, in spec order. */
const KNOWN_TAGS = [
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
	"cvt", "fpgm", "glyf", "loca", "prep", "CFF", "VORG", "EBDT",
	"EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
	"vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
	"CBDT", "CBLC", "COLR", "CPAL", "SVG", "sbix", "acnt", "avar",
	"bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
	"gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
	"trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

/**
 * How often each character appears in English, used to weight the average
 * character width. The OS/2 table has a field for this, but fonts disagree
 * on what it means, so it is measured from the advance widths instead.
 */
const WEIGHTINGS = {
	a: 0.0668, b: 0.0122, c: 0.0228, d: 0.0348, e: 0.1039, f: 0.0182,
	g: 0.0165, h: 0.0499, i: 0.057, j: 0.001, k: 0.0063, l: 0.033,
	m: 0.0197, n: 0.0552, o: 0.0614, p: 0.0158, q: 0.0008, r: 0.049,
	s: 0.0518, t: 0.0741, u: 0.0226, v: 0.008, w: 0.0193, x: 0.0015,
	y: 0.0161, z: 0.0007, " ": 0.1818,
};

/**
 * Reads the metrics a font declares about itself, so a fallback can be
 * adjusted to occupy the same space and the page does not shift when the
 * webfont arrives. Reads woff2, woff, ttf and otf.
 *
 * @param {Buffer} bytes
 * @returns {Metrics|null} null when the font cannot be read or lacks a glyph for a..z
 */
export function readMetrics(bytes) {
	try {
		const signature = bytes.toString("latin1", 0, 4);
		const tables = signature === "wOF2" ? readWoff2(bytes) : signature === "wOFF" ? readWoff(bytes) : readSfnt(bytes);
		const { head, hhea } = tables;
		if (!head || !hhea) return null;

		// A font sets USE_TYPO_METRICS when its OS/2 typo values are the ones
		// it wants line boxes built from, otherwise hhea is authoritative.
		const os2 = tables["OS/2"];
		const useTypo = os2 !== undefined && (os2.readUInt16BE(62) & (1 << 7)) !== 0;
		const xWidthAvg = averageWidth(tables);
		if (!xWidthAvg) return null;

		return {
			unitsPerEm: head.readUInt16BE(18),
			ascent: useTypo ? os2.readInt16BE(68) : hhea.readInt16BE(4),
			descent: useTypo ? os2.readInt16BE(70) : hhea.readInt16BE(6),
			lineGap: useTypo ? os2.readInt16BE(72) : hhea.readInt16BE(8),
			xWidthAvg,
		};
	} catch {
		return null;
	}
}

/**
 * Reads a 4 byte table tag, without its padding spaces.
 *
 * @param {Buffer} bytes
 * @param {number} offset
 * @returns {string}
 */
function readTag(bytes, offset) {
	if (offset + 4 > bytes.length) throw new RangeError("The offset is out of range.");

	return bytes.toString("latin1", offset, offset + 4).replace(/^[ \0]+|[ \0]+$/g, "");
}

/**
 * Splits a woff2 into its tables. Everything is one Brotli stream, and the
 * directory gives the length of each table within it.
 *
 * @param {Buffer} bytes
 * @returns {Record<string, Buffer>}
 */
function readWoff2(bytes) {
	const numTables = bytes.readUInt16BE(12);
	const totalCompressedSize = bytes.readUInt32BE(20);
	const entries = [];
	let pos = 48;

	for (let i = 0; i < numTables; i++) {
		const flags = bytes.readUInt8(pos++);
		const index = flags & 0x3f;
		let tag;
		if (index === 63) {
			tag = readTag(bytes, pos);
			pos += 4;
		} else {
			tag = KNOWN_TAGS[index];
		}

		let length;
		[length, pos] = readBase128(bytes, pos);

		const version = flags >> 6;
		const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
		if (transformed) {
			[length, pos] = readBase128(bytes, pos);
		}

		entries.push({ tag, length, transformed });
	}

	const data = brotliDecompressSync(bytes.subarray(pos, pos + totalCompressedSize));
	const tables = {};
	let offset = 0;
	for (const entry of entries) {
		// A transformed table is not in the layout this reads, so it is skipped.
		if (!entry.transformed) {
			tables[entry.tag] = data.subarray(offset, offset + entry.length);
		}
		offset += entry.length;
	}

	return tables;
}

/**
 * Splits a woff into its tables, each zlib compressed when that made it smaller.
 *
 * @param {Buffer} bytes
 * @returns {Record<string, Buffer>}
 */
function readWoff(bytes) {
	const numTables = bytes.readUInt16BE(12);
	const tables = {};

	for (let i = 0; i < numTables; i++) {
		const entry = 44 + i * 20;
		const tag = readTag(bytes, entry);
		const offset = bytes.readUInt32BE(entry + 4);
		const compLength = bytes.readUInt32BE(entry + 8);
		const origLength = bytes.readUInt32BE(entry + 12);
		const data = bytes.subarray(offset, offset + compLength);

		tables[tag] = compLength < origLength ? inflateSync(data) : data;
	}

	return tables;
}

/**
 * Splits a plain TrueType or OpenType font into its tables.
 *
 * @param {Buffer} bytes
 * @returns {Record<string, Buffer>}
 */
function readSfnt(bytes) {
	const numTables = bytes.readUInt16BE(4);
	const tables = {};

	for (let i = 0; i < numTables; i++) {
		const entry = 12 + i * 16;
		const offset = bytes.readUInt32BE(entry + 8);
		tables[readTag(bytes, entry)] = bytes.subarray(offset, offset + bytes.readUInt32BE(entry + 12));
	}

	return tables;
}

/**
 * Reads a UIntBase128, the variable length integer of a woff2 directory.
 *
 * @param {Buffer} bytes
 * @param {number} pos
 * @returns {[number, number]} the value and the position after it
 */
function readBase128(bytes, pos) {
	let value = 0;
	for (let i = 0; i < 5; i++) {
		const byte = bytes.readUInt8(pos++);
		value = ((value << 7) | (byte & 0x7f)) >>> 0;
		if ((byte & 0x80) === 0) return [value, pos];
	}

	throw new RangeError("Invalid UIntBase128");
}

/**
 * Looks a code point up in a format 4 cmap subtable.
 *
 * @param {Buffer} table
 * @param {number} code
 * @returns {number} glyph id, 0 when absent
 */
function lookupFormat4(table, code) {
	const segCount = Math.floor(table.readUInt16BE(6) / 2);
	const end = 14;
	const start = end + segCount * 2 + 2;
	const delta = start + segCount * 2;
	const range = delta + segCount * 2;

	for (let i = 0; i < segCount; i++) {
		if (table.readUInt16BE(end + i * 2) < code) continue;
		if (table.readUInt16BE(start + i * 2) > code) return 0;

		const rangeOffset = table.readUInt16BE(range + i * 2);
		if (rangeOffset === 0) {
			return (code + table.readInt16BE(delta + i * 2)) & 0xffff;
		}

		const glyph = table.readUInt16BE(range + i * 2 + rangeOffset + (code - table.readUInt16BE(start + i * 2)) * 2);

		return glyph === 0 ? 0 : (glyph + table.readInt16BE(delta + i * 2)) & 0xffff;
	}

	return 0;
}

/**
 * Looks a code point up in a format 12 cmap subtable.
 *
 * @param {Buffer} table
 * @param {number} code
 * @returns {number} glyph id, 0 when absent
 */
function lookupFormat12(table, code) {
	const groups = table.readUInt32BE(12);

	for (let i = 0; i < groups; i++) {
		const group = 16 + i * 12;
		const first = table.readUInt32BE(group);
		if (code >= first && code <= table.readUInt32BE(group + 4)) {
			return table.readUInt32BE(group + 8) + (code - first);
		}
	}

	return 0;
}

/**
 * Picks the Unicode cmap subtable to read code points from.
 *
 * @param {Buffer} cmap
 * @returns {{table: Buffer, format: number}|null}
 */
function unicodeSubtable(cmap) {
	let chosen = null;
	const count = cmap.readUInt16BE(2);

	for (let i = 0; i < count; i++) {
		const record = 4 + i * 8;
		const platform = cmap.readUInt16BE(record);
		const encoding = cmap.readUInt16BE(record + 2);
		if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;

		const table = cmap.subarray(cmap.readUInt32BE(record + 4));
		const format = table.readUInt16BE(0);
		// Format 12 covers the whole range, so it wins when both are present.
		if (format === 12 || (format === 4 && chosen === null)) {
			chosen = { table, format };
		}
	}

	return chosen;
}

/**
 * Measures the average character width, weighted by how often each
 * character appears in English.
 *
 * @param {Record<string, Buffer>} tables
 * @returns {number|null} width in font units, null when it cannot be read
 */
function averageWidth({ cmap, hmtx, hhea }) {
	if (!cmap || !hmtx || !hhea) return null;

	const subtable = unicodeSubtable(cmap);
	if (subtable === null) return null;

	const numHMetrics = hhea.readUInt16BE(34);
	let total = 0;
	let weightingTotal = 0;
	for (const weight of Object.values(WEIGHTINGS)) {
		weightingTotal += weight;
	}

	for (const [character, weight] of Object.entries(WEIGHTINGS)) {
		const code = character.charCodeAt(0);
		const glyph = subtable.format === 12
			? lookupFormat12(subtable.table, code)
			: lookupFormat4(subtable.table, code);
		if (!glyph) return null;

		const at = Math.min(glyph, numHMetrics - 1) * 4;
		if (at + 2 > hmtx.length) return null;
		total += hmtx.readUInt16BE(at) * weight;
	}

	return Math.round(total / weightingTotal);
}
