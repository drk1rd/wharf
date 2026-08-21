import type { QueryResult } from "./api";

function triggerDownload(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function resultToCsv(result: QueryResult): string {
  if (result.rows.length === 0) return "";
  const columns = result.columns && result.columns.length > 0 ? result.columns : Object.keys(result.rows[0] as object);
  const lines = [columns.map(csvCell).join(",")];
  for (const row of result.rows) {
    lines.push(columns.map((c) => csvCell((row as Record<string, unknown>)[c])).join(","));
  }
  return lines.join("\n");
}

export function downloadResultAsCsv(result: QueryResult, filenameBase: string) {
  triggerDownload(resultToCsv(result), "text/csv;charset=utf-8", `${filenameBase}.csv`);
}

export function downloadResultAsJson(result: QueryResult, filenameBase: string) {
  triggerDownload(JSON.stringify(result.rows, null, 2), "application/json", `${filenameBase}.json`);
}
