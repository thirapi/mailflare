/** Same rule as `hasScope` in key-auth.ts, repeated here so this module stays free of database imports. */
function hasScope(scopes: string[], required: string): boolean {
	return scopes.includes(required) || scopes.includes("*");
}

export const DAV_BASE = "/dav";
export const DAV_PRINCIPAL_PATH = `${DAV_BASE}/principals/me/`;
export const DAV_CALENDAR_PATH = `${DAV_BASE}/calendars/default/`;
export const DAV_CONTACTS_PATH = `${DAV_BASE}/addressbooks/default/`;

/** Scopes an app password needs to sync calendar and contacts. */
export const DAV_SCOPES = ["calendar:read", "calendar:write", "contacts:read"] as const;

export type DavPath =
	| { kind: "root" }
	| { kind: "principals" }
	| { kind: "principal" }
	| { kind: "calendar-home" }
	| { kind: "calendar" }
	| { kind: "event"; name: string }
	| { kind: "contacts-home" }
	| { kind: "contacts" }
	| { kind: "card"; name: string };

/** Requests `worker.ts` and the Node server hand to the DAV handler instead of the app. */
export function isDavPath(pathname: string): boolean {
	return pathname === DAV_BASE || pathname.startsWith(`${DAV_BASE}/`)
		|| pathname === "/.well-known/caldav" || pathname === "/.well-known/carddav";
}

export function parseDavPath(pathname: string): DavPath | null {
	if (pathname !== DAV_BASE && !pathname.startsWith(`${DAV_BASE}/`)) return null;
	let segments: string[];
	try {
		segments = pathname.slice(DAV_BASE.length).split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
	} catch {
		return null;
	}
	const [first, second, third, ...rest] = segments;
	if (rest.length) return null;
	if (!first) return { kind: "root" };
	if (first === "principals") {
		if (!second) return { kind: "principals" };
		return second === "me" && !third ? { kind: "principal" } : null;
	}
	if (first === "calendars") {
		if (!second) return { kind: "calendar-home" };
		if (second !== "default") return null;
		return third ? { kind: "event", name: third } : { kind: "calendar" };
	}
	if (first === "addressbooks") {
		if (!second) return { kind: "contacts-home" };
		if (second !== "default") return null;
		return third ? { kind: "card", name: third } : { kind: "contacts" };
	}
	return null;
}

/** Client-chosen resource names are stored and echoed in hrefs, so keep them to a plain, bounded file name. */
export function isSafeResourceName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._@~+=-]{0,199}$/.test(name) && !name.includes("..");
}

export function eventResourceName(row: { id: string; davName?: string | null }): string {
	return row.davName ?? `${row.id}.ics`;
}

/** The resource name an href in a multiget points at inside `collection`, or null when it is elsewhere. */
export function hrefToResourceName(href: string, collection: string): string | null {
	let path = href;
	try {
		if (/^https?:\/\//i.test(path)) path = new URL(path).pathname;
		path = decodeURIComponent(path);
	} catch {
		return null;
	}
	const decodedCollection = decodeURIComponent(collection);
	if (!path.startsWith(decodedCollection)) return null;
	const name = path.slice(decodedCollection.length);
	return name && !name.includes("/") ? name : null;
}

export function davCanRead(scopes: string[]): boolean {
	return DAV_SCOPES.some((scope) => hasScope(scopes, scope));
}

export function davAllowsWrite(scopes: string[]): boolean {
	return hasScope(scopes, "calendar:write");
}

/**
 * Whether an event can have an occurrence in [start, end). A repeating series is kept unless it ended before the
 * range; a client asking for a window gets every series that might reach into it and expands it itself.
 */
export function timeRangeOverlaps(
	event: { startsAt: Date; endsAt: Date; repeat: string; repeatUntil: Date | null },
	start: Date | null,
	end: Date | null,
): boolean {
	if (end && event.startsAt >= end) return false;
	if (!start) return true;
	if (event.repeat !== "none") return !event.repeatUntil || event.repeatUntil > start;
	return event.endsAt > start;
}
