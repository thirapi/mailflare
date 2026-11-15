self.addEventListener("install", () => {
	console.log("[sw] installed, activating immediately");
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	console.log("[sw] activated, claiming clients");
	event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

// Offline start: pages are network-first with the last good copy as fallback, and
// hashed build assets are cache-first. API calls are never cached here; the app keeps
// its own offline copy of mail in IndexedDB and clears both on sign-out.
// Keep the name in sync with OFFLINE_PAGE_CACHE in src/lib/offline/store-utils.ts.
const PAGE_CACHE = "mailflare-pages-v1";
const OFFLINE_FALLBACK_PATH = "/inbox";

function isCacheableResponse(response) {
	return response && response.ok && response.type === "basic" && !response.redirected;
}

async function cacheFirst(request) {
	const cache = await caches.open(PAGE_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;
	const response = await fetch(request);
	if (isCacheableResponse(response)) await cache.put(request, response.clone());
	return response;
}

async function networkFirst(request, fallbackPath) {
	const cache = await caches.open(PAGE_CACHE);
	const key = new URL(request.url);
	key.search = "";
	try {
		const response = await fetch(request);
		if (isCacheableResponse(response)) await cache.put(key.href, response.clone());
		return response;
	} catch (error) {
		const cached = await cache.match(key.href)
			?? (fallbackPath ? await cache.match(new URL(fallbackPath, self.location.origin).href) : undefined);
		if (cached) return cached;
		throw error;
	}
}

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	const path = url.pathname;
	if (path.startsWith("/api/") || path.startsWith("/jmap") || path.startsWith("/.well-known/") || path.startsWith("/dav") || path === "/sw.js") return;
	// Hashed build output never changes under one URL; locale catalogs do, so they stay network-first.
	if (path.startsWith("/_next/static/")) {
		event.respondWith(cacheFirst(request));
		return;
	}
	if (path.startsWith("/locales/")) {
		event.respondWith(networkFirst(request));
		return;
	}
	if (request.mode === "navigate") event.respondWith(networkFirst(request, OFFLINE_FALLBACK_PATH));
});

const DEFAULT_NOTIFICATION = {
	title: "New email",
	body: "You have a new message",
	icon: "/icon-192.png",
	badge: "/icon-96.png",
	url: "/inbox",
};

async function syncAppBadge() {
	if (!("setAppBadge" in self.navigator)) return;
	try {
		const response = await fetch("/api/messages/counts", { credentials: "include" });
		if (!response.ok) return;
		const unread = (await response.json())?.counts?.folders?.inbox?.unread;
		if (typeof unread !== "number") return;
		await (unread > 0 ? self.navigator.setAppBadge(unread) : self.navigator.clearAppBadge());
	} catch {
		// Leave the badge as it was when the network is down or the API rejects outside an installed app.
	}
}

self.addEventListener("push", (event) => {
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			if (windows.some((client) => client.visibilityState === "visible")) return;

			let payload = DEFAULT_NOTIFICATION;
			try {
				payload = { ...DEFAULT_NOTIFICATION, ...(event.data?.json() ?? {}) };
			} catch {
				// Keep the generic notification if a provider delivers an empty or malformed payload.
			}

			await Promise.all([
				self.registration.showNotification(payload.title, {
					body: payload.body,
					icon: payload.icon,
					badge: payload.badge,
					tag: payload.tag,
					data: { url: payload.url },
				}),
				syncAppBadge(),
			]);
		})(),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || "/inbox", self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			for (const client of windows) {
				if (client.url.startsWith(self.location.origin)) {
					await client.focus();
					await client.navigate(target);
					return;
				}
			}
			await self.clients.openWindow(target);
		})(),
	);
});
