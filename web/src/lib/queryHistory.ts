const MAX_ENTRIES = 8;

function storageKey(scope: string): string {
  return `wharf-query-history:${scope}`;
}

export function loadQueryHistory(scope: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === "string") : [];
  } catch {
    return [];
  }
}

/** Most-recent-first, deduplicated, capped — returns the updated list so the caller can update its own state without a second read. */
export function pushQueryHistory(scope: string, query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return loadQueryHistory(scope);
  const next = [trimmed, ...loadQueryHistory(scope).filter((q) => q !== trimmed)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // localStorage can throw (private browsing, quota) — history is a convenience, not worth failing the query over.
  }
  return next;
}
