import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseJsonRows } from "../import.js";

test("parseCsv turns a header + rows into objects keyed by column name", () => {
  const rows = parseCsv("name,email\nAda,ada@example.com\nGrace,grace@example.com");
  assert.deepEqual(rows, [
    { name: "Ada", email: "ada@example.com" },
    { name: "Grace", email: "grace@example.com" },
  ]);
});

test("parseCsv handles quoted fields containing commas, quotes, and newlines", () => {
  const rows = parseCsv('name,note\n"Ada, Countess","says ""hi""\nsecond line"');
  assert.deepEqual(rows, [{ name: "Ada, Countess", note: 'says "hi"\nsecond line' }]);
});

test("parseCsv round-trips resultToCsv's own escaping (web/src/lib/export.ts)", () => {
  // Mirrors csvCell()'s escaping directly rather than importing across
  // workspaces — control-plane and web are separate packages.
  const header = "a,b";
  const row = '"has, comma","has ""quote"""';
  const rows = parseCsv(`${header}\n${row}`);
  assert.deepEqual(rows, [{ a: "has, comma", b: 'has "quote"' }]);
});

test("parseCsv returns an empty array for header-only input", () => {
  assert.deepEqual(parseCsv("name,email"), []);
});

test("parseJsonRows accepts an array of plain objects", () => {
  const rows = parseJsonRows('[{"a": 1}, {"a": 2}]');
  assert.deepEqual(rows, [{ a: 1 }, { a: 2 }]);
});

test("parseJsonRows rejects non-array JSON", () => {
  assert.throws(() => parseJsonRows('{"a": 1}'), /array/);
});

test("parseJsonRows rejects an array containing a non-object", () => {
  assert.throws(() => parseJsonRows("[1, 2]"), /plain object/);
});

test("parseJsonRows rejects invalid JSON", () => {
  assert.throws(() => parseJsonRows("not json"), /invalid JSON/);
});
