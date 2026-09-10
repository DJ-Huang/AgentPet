"use strict";

// Windows decodes bytes 0x80-0x9f as Windows-1252 punctuation instead of the
// C1 control characters used by ISO-8859-1. Cursor hook stdin can pass through
// that conversion before Node receives it, so Buffer's "latin1" encoder alone
// cannot reconstruct the original UTF-8 bytes (for example, 0x99 becomes ™).
const WINDOWS_1252_BYTES = new Map([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

function windows1252Bytes(value) {
  const bytes = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xff) {
      bytes.push(codePoint);
    } else if (WINDOWS_1252_BYTES.has(codePoint)) {
      bytes.push(WINDOWS_1252_BYTES.get(codePoint));
    } else {
      return null;
    }
  }
  return Buffer.from(bytes);
}

function repairUtf8Mojibake(value) {
  if (typeof value !== "string" || !value) return value;
  if (/\p{Script=Han}/u.test(value)) return value;

  // The activity list appends this character after truncating a title. It is
  // presentation text, not part of the mis-decoded byte stream.
  const suffix = value.endsWith("…") ? "…" : "";
  const candidate = suffix ? value.slice(0, -1) : value;
  if (/[^\u0000-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2026\u2030\u2039\u203a\u20ac\u2122]/u.test(candidate)) {
    return value;
  }

  const bytes = windows1252Bytes(candidate);
  if (!bytes) return value;
  const repaired = bytes.toString("utf8");
  if (/\uFFFD/.test(repaired)) return value;
  if (/\p{Script=Han}/u.test(repaired)) return repaired + suffix;
  return value;
}

module.exports = { repairUtf8Mojibake };
