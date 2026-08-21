/**
 * Parses CSV text into row objects keyed by the header row — the inverse of
 * web/src/lib/export.ts's resultToCsv, handling the same RFC4180-ish quoting
 * (quoted fields, doubled "" for an embedded quote, commas/newlines inside
 * quotes). Not a full CSV-spec parser, just enough to round-trip what this
 * app's own export produces and typical simple CSVs a user hands it.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length > 1 || r[0] !== "")
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => {
        obj[h] = r[idx] ?? "";
      });
      return obj;
    });
}

/** JSON import expects a top-level array of plain objects — one per row/document. */
export function parseJsonRows(text: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("JSON import must be an array of objects, e.g. [{\"col\": \"value\"}, ...]");
  }
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("every item in the JSON array must be a plain object");
    }
  }
  return parsed as Record<string, unknown>[];
}
