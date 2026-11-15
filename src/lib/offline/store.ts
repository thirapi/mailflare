import {
	isFreshEntry,
	isNetworkFailure,
	keysToEvict,
	OFFLINE_ENTRY_LIMIT,
	OFFLINE_PAGE_CACHE,
	OFFLINE_STATE_EVENT,
	type OfflineEntry,
} from "./store-utils";

// A small key-value store in IndexedDB that keeps the last copy of mail the user saw, so
// lists and opened messages still show when the network is down. It is a fallback only:
// online reads always go to the server, and everything is cleared when the session changes.

const DB_NAME = "mailflare-offline";
const STORE = "entries";
const VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let servingOffline = false;

/**
 * True while the server is unreachable: the last request failed on the network, and a saved copy (if any) was shown
 * instead. `navigator.onLine` alone is not enough: it stays true on a
 * connection that cannot reach the server (captive portals, a dead mobile signal, and after reloading while offline).
 */
export function isServingOffline(): boolean {
	return servingOffline;
}

function setServingOffline(next: boolean) {
	if (servingOffline === next) return;
	servingOffline = next;
	if (typeof window !== "undefined") window.dispatchEvent(new Event(OFFLINE_STATE_EVENT));
}

let writesSinceEviction = 0;

function openDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return Promise.resolve(null);
	if (!dbPromise) {
		dbPromise = new Promise<IDBDatabase | null>((resolve) => {
			try {
				const request = indexedDB.open(DB_NAME, VERSION);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains(STORE)) {
						db.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt");
					}
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => resolve(null);
				request.onblocked = () => resolve(null);
			} catch {
				// Private windows and blocked storage: run without an offline copy.
				resolve(null);
			}
		});
	}
	return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
	return openDb().then((db) => new Promise<T | undefined>((resolve) => {
		if (!db) return resolve(undefined);
		try {
			const tx = db.transaction(STORE, mode);
			const request = action(tx.objectStore(STORE));
			tx.oncomplete = () => resolve(request ? request.result : undefined);
			tx.onerror = () => resolve(undefined);
			tx.onabort = () => resolve(undefined);
		} catch {
			resolve(undefined);
		}
	}));
}

export async function readOffline<T>(key: string): Promise<T | undefined> {
	const entry = await run<OfflineEntry<T>>("readonly", (store) => store.get(key) as IDBRequest<OfflineEntry<T>>);
	return isFreshEntry(entry) ? entry.value as T : undefined;
}

export async function saveOffline<T>(key: string, value: T): Promise<void> {
	await run("readwrite", (store) => { store.put({ key, value, savedAt: Date.now() } satisfies OfflineEntry<T>); });
	writesSinceEviction += 1;
	if (writesSinceEviction >= 25) {
		writesSinceEviction = 0;
		await evictOldEntries();
	}
}

async function evictOldEntries(): Promise<void> {
	const entries = await run<Array<OfflineEntry>>("readonly", (store) => store.getAll() as IDBRequest<OfflineEntry[]>);
	const stale = keysToEvict(entries ?? [], OFFLINE_ENTRY_LIMIT);
	if (!stale.length) return;
	await run("readwrite", (store) => { for (const key of stale) store.delete(key); });
}

/** Drop every offline copy: on sign-out and account switches, so the next user never sees it. */
export async function clearOffline(): Promise<void> {
	writesSinceEviction = 0;
	setServingOffline(false);
	await run("readwrite", (store) => { store.clear(); });
	try {
		if (typeof caches !== "undefined") await caches.delete(OFFLINE_PAGE_CACHE);
	} catch {
		// Cache Storage may be unavailable; the service worker refreshes pages on the next visit anyway.
	}
}

/**
 * Run `load` and keep its result under `key`; when the request never reaches the
 * server, answer with the last kept copy instead (or rethrow when there is none).
 */
export async function withOfflineFallback<T>(key: string, load: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
	try {
		const value = await load();
		setServingOffline(false);
		if (keep(value)) void saveOffline(key, value);
		return value;
	} catch (error) {
		if (!isNetworkFailure(error)) throw error;
		// Unreachable either way: with a saved copy the app shows it, without one it shows the offline state.
		setServingOffline(true);
		const cached = await readOffline<T>(key);
		if (cached === undefined) throw error;
		return cached;
	}
}
