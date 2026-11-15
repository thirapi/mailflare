/** Most entries kept in the offline store; the oldest saved are dropped first. */
export const OFFLINE_ENTRY_LIMIT = 400;
/** Entries older than this are never served, so a long-closed device does not show stale mail as current. */
export const OFFLINE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Service worker cache holding pages and static assets for offline start. */
export const OFFLINE_PAGE_CACHE = "mailflare-pages-v1";

export type OfflineEntry<T = unknown> = { key: string; value: T; savedAt: number };

/**
 * A fetch that never reached the server: the browser reports it as a TypeError
 * ("Failed to fetch", "NetworkError…", "Load failed"), or the device says it is offline.
 */
export function isNetworkFailure(error: unknown, online = typeof navigator === "undefined" ? true : navigator.onLine): boolean {
	if (!online) return true;
	return error instanceof TypeError;
}

export function isFreshEntry(entry: OfflineEntry | undefined, now = Date.now()): entry is OfflineEntry {
	return !!entry && now - entry.savedAt <= OFFLINE_MAX_AGE_MS;
}

/** Keys to delete so at most `limit` entries remain, oldest first. */
export function keysToEvict(entries: Array<Pick<OfflineEntry, "key" | "savedAt">>, limit = OFFLINE_ENTRY_LIMIT): string[] {
	if (entries.length <= limit) return [];
	return [...entries]
		.sort((a, b) => a.savedAt - b.savedAt)
		.slice(0, entries.length - limit)
		.map((entry) => entry.key);
}
