import { and, eq, inArray, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, contacts } from "@/db/schema";
import { authenticateApiRequest, hasScope } from "@/lib/api/key-auth";
import type { ApiAuthResult } from "@/lib/api/key-auth-types";
import { newId } from "@/lib/ids";
import { normalizeTimeZone } from "@/lib/time/utils";
import { buildContactVcard, buildEventIcs, eventUid, eventValuesFromIcs, type DavEvent } from "./objects";
import {
	DAV_BASE,
	DAV_CALENDAR_PATH,
	DAV_CONTACTS_PATH,
	DAV_PRINCIPAL_PATH,
	davAllowsWrite,
	davCanRead,
	eventResourceName,
	hrefToResourceName,
	isSafeResourceName,
	parseDavPath,
	timeRangeOverlaps,
	type DavPath,
} from "./utils";
import { child, clark, descendants, escapeXml, NAMESPACE_DECLARATIONS, NS, parseClark, parseXml, qname, type XmlElement } from "./xml";

/**
 * CalDAV (RFC 4791) and CardDAV (RFC 6352) for phone and desktop calendar and contacts apps.
 *
 * One calendar (`/dav/calendars/default/`, read-write) and one address book (`/dav/addressbooks/default/`,
 * read-only) per account, signed in with HTTP Basic auth using an API key as the password, like JMAP. Next route
 * handlers cannot receive PROPFIND or REPORT, so `worker.ts` and the Node server call this before the app.
 * Change detection is by CTag and ETag; sync-collection is not offered, so clients fall back to comparing ETags.
 */

const MAX_BODY_BYTES = 1024 * 1024;
const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8" };
const DAV_HEADER = "1, 3, calendar-access, addressbook";
const ALLOW = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT";

type Db = ReturnType<typeof getDb>;
type EventRow = typeof calendarEvents.$inferSelect;
type ContactRow = Pick<typeof contacts.$inferSelect, "id" | "email" | "displayName" | "createdAt" | "lastSeenAt">;

type Resource = {
	href: string;
	props: Map<string, string | null>;
};

type Context = { env: CloudflareEnv; db: Db; auth: ApiAuthResult; origin: string };

export async function handleDavRequest(request: Request, env: CloudflareEnv): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/.well-known/caldav" || url.pathname === "/.well-known/carddav") {
		return new Response(null, { status: 301, headers: { Location: `${DAV_BASE}/` } });
	}
	const method = request.method.toUpperCase();
	if (method === "OPTIONS") return new Response(null, { status: 200, headers: { DAV: DAV_HEADER, Allow: ALLOW } });

	const auth = await authenticateApiRequest(env, request);
	if (!auth || !davCanRead(auth.scopes)) {
		return new Response("Sign in with your email address and an app password that can sync calendar or contacts.", {
			status: 401,
			headers: { "WWW-Authenticate": 'Basic realm="Mailflare", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" },
		});
	}
	const path = parseDavPath(url.pathname);
	if (!path) return new Response("Not found", { status: 404 });
	const ctx: Context = { env, db: getDb(env), auth, origin: url.origin };

	const isCalendar = path.kind === "calendar-home" || path.kind === "calendar" || path.kind === "event";
	const isContacts = path.kind === "contacts-home" || path.kind === "contacts" || path.kind === "card";
	if (isCalendar && (!auth.user.calendarEnabled || !hasScope(auth.scopes, "calendar:read") && !hasScope(auth.scopes, "calendar:write"))) return forbidden();
	if (isContacts && !hasScope(auth.scopes, "contacts:read")) return forbidden();

	try {
		switch (method) {
			case "PROPFIND": return await propfind(ctx, path, request);
			case "REPORT": return await report(ctx, path, request);
			case "PROPPATCH": return await proppatch(path, request);
			case "GET":
			case "HEAD": return await get(ctx, path, method === "HEAD");
			case "PUT": return await put(ctx, path, request);
			case "DELETE": return await remove(ctx, path, request);
			case "MKCALENDAR":
			case "MKCOL":
			case "MOVE":
			case "COPY": return forbidden();
			default: return new Response("Method not allowed", { status: 405, headers: { Allow: ALLOW } });
		}
	} catch (error) {
		if (error instanceof BodyTooLargeError) return new Response("Request body too large", { status: 413 });
		console.error("[dav] request failed", error);
		return new Response("Internal error", { status: 500 });
	}
}

class BodyTooLargeError extends Error {}

async function readBody(request: Request): Promise<string> {
	const declared = Number(request.headers.get("Content-Length") ?? "0");
	if (declared > MAX_BODY_BYTES) throw new BodyTooLargeError();
	const buffer = await request.arrayBuffer();
	if (buffer.byteLength > MAX_BODY_BYTES) throw new BodyTooLargeError();
	return new TextDecoder().decode(buffer);
}

function forbidden(condition = "need-privileges"): Response {
	return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<d:error ${NAMESPACE_DECLARATIONS}><d:${condition}/></d:error>`, { status: 403, headers: XML_HEADERS });
}

function preconditionFailed(): Response {
	return new Response("Precondition failed", { status: 412 });
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------- Data ----------

function toDavEvent(row: EventRow): DavEvent {
	return { ...row, davUid: row.davUid ?? null, reminderMinutes: row.reminderMinutes ?? null };
}

type EventObject = { row: EventRow; name: string; data: string; etag: string };

async function eventObject(row: EventRow): Promise<EventObject> {
	// DTSTAMP is pinned to the last change so an unchanged event always has the same body and ETag.
	const data = buildEventIcs(toDavEvent(row), row.updatedAt);
	return { row, name: eventResourceName(row), data, etag: `"${(await sha256Hex(data)).slice(0, 32)}"` };
}

async function listEventObjects(ctx: Context): Promise<EventObject[]> {
	const rows = await ctx.db.select().from(calendarEvents).where(eq(calendarEvents.userId, ctx.auth.userId));
	return Promise.all(rows.map(eventObject));
}

async function findEventRow(ctx: Context, name: string): Promise<EventRow | undefined> {
	const id = name.endsWith(".ics") ? name.slice(0, -4) : name;
	const rows = await ctx.db.select().from(calendarEvents).where(and(
		eq(calendarEvents.userId, ctx.auth.userId),
		or(eq(calendarEvents.davName, name), eq(calendarEvents.id, id)),
	));
	// A client-chosen name wins over an id that happens to look the same.
	return rows.find((row) => row.davName === name) ?? rows.find((row) => !row.davName && row.id === id);
}

type CardObject = { row: ContactRow; name: string; data: string; etag: string };

async function listCardObjects(ctx: Context): Promise<CardObject[]> {
	// The address book is the people this account writes to or saved by hand; senders it only received from
	// (newsletters, spam) and blocked addresses stay out of the phone's contacts.
	const rows = await ctx.db
		.select({ id: contacts.id, email: contacts.email, displayName: contacts.displayName, createdAt: contacts.createdAt, lastSeenAt: contacts.lastSeenAt })
		.from(contacts)
		.where(and(eq(contacts.userId, ctx.auth.userId), eq(contacts.blocked, false), inArray(contacts.source, ["manual", "outbound"])));
	return Promise.all(rows.map(async (row) => {
		// Contact ids embed the owner and the address, so the UID and resource name are a digest of the id instead.
		const uid = (await sha256Hex(`contact:${row.id}`)).slice(0, 32);
		const data = buildContactVcard({ ...row, uid });
		return { row, name: `${uid}.vcf`, data, etag: `"${(await sha256Hex(data)).slice(0, 32)}"` };
	}));
}

async function collectionTag(items: Array<{ name: string; etag: string }>): Promise<string> {
	return (await sha256Hex(items.map((item) => `${item.name} ${item.etag}`).sort().join("\n"))).slice(0, 32);
}

// ---------- Properties ----------

/** An XML element for a property, declaring its namespace inline when it is not one of the usual DAV ones. */
function element(ns: string, name: string, inner: string | null): string {
	const tag = qname(ns, name);
	const declare = tag === name ? ` xmlns="${escapeXml(ns)}"` : "";
	return inner === null || inner === "" ? `<${tag}${declare}/>` : `<${tag}${declare}>${inner}</${tag}>`;
}

const D = (name: string) => clark(NS.dav, name);
const CAL = (name: string) => clark(NS.caldav, name);
const CARD = (name: string) => clark(NS.carddav, name);
const CS = (name: string) => clark(NS.cs, name);
const APPLE = (name: string) => clark(NS.apple, name);

const hrefXml = (href: string) => `<d:href>${escapeXml(href)}</d:href>`;

function privileges(write: boolean): string {
	const names = write
		? ["read", "read-current-user-privilege-set", "write-content", "bind", "unbind"]
		: ["read", "read-current-user-privilege-set"];
	return names.map((name) => `<d:privilege><d:${name}/></d:privilege>`).join("");
}

function commonProps(ctx: Context): Map<string, string | null> {
	return new Map<string, string | null>([
		[D("current-user-principal"), hrefXml(DAV_PRINCIPAL_PATH)],
		[D("principal-URL"), hrefXml(DAV_PRINCIPAL_PATH)],
		[D("owner"), hrefXml(DAV_PRINCIPAL_PATH)],
		[CAL("calendar-home-set"), ctx.auth.user.calendarEnabled ? hrefXml(`${DAV_BASE}/calendars/`) : null],
		[CARD("addressbook-home-set"), hrefXml(`${DAV_BASE}/addressbooks/`)],
	]);
}

function collectionResource(ctx: Context, href: string, types: string, displayName: string, extra: Array<[string, string | null]> = []): Resource {
	const props = commonProps(ctx);
	props.set(D("resourcetype"), `<d:collection/>${types}`);
	props.set(D("displayname"), escapeXml(displayName));
	for (const [key, value] of extra) props.set(key, value);
	return { href, props };
}

function principalResource(ctx: Context): Resource {
	const props = commonProps(ctx);
	props.set(D("resourcetype"), "<d:principal/>");
	props.set(D("displayname"), escapeXml(ctx.auth.user.name || ctx.auth.email));
	props.set(CAL("calendar-user-address-set"), hrefXml(`mailto:${ctx.auth.email}`));
	return { href: DAV_PRINCIPAL_PATH, props };
}

async function calendarResource(ctx: Context, objects?: EventObject[]): Promise<Resource> {
	const items = objects ?? await listEventObjects(ctx);
	const tag = await collectionTag(items);
	const write = davAllowsWrite(ctx.auth.scopes);
	return collectionResource(ctx, DAV_CALENDAR_PATH, "<cal:calendar/>", "Mailflare", [
		[CAL("supported-calendar-component-set"), '<cal:comp name="VEVENT"/>'],
		[CAL("supported-calendar-data"), '<cal:calendar-data content-type="text/calendar" version="2.0"/>'],
		[CAL("calendar-description"), "Mailflare calendar"],
		[CS("getctag"), tag],
		[D("getetag"), `"${tag}"`],
		[D("current-user-privilege-set"), privileges(write)],
		[D("supported-report-set"), ["calendar-multiget", "calendar-query"].map((name) => `<d:supported-report><d:report><cal:${name}/></d:report></d:supported-report>`).join("")],
		[APPLE("calendar-color"), "#2563EBFF"],
		[APPLE("calendar-order"), "1"],
	]);
}

async function contactsResource(ctx: Context, objects?: CardObject[]): Promise<Resource> {
	const items = objects ?? await listCardObjects(ctx);
	const tag = await collectionTag(items);
	return collectionResource(ctx, DAV_CONTACTS_PATH, "<card:addressbook/>", "Mailflare", [
		[CARD("supported-address-data"), '<card:address-data-type content-type="text/vcard" version="3.0"/>'],
		[CARD("addressbook-description"), "People you write to from Mailflare"],
		[CS("getctag"), tag],
		[D("getetag"), `"${tag}"`],
		[D("current-user-privilege-set"), privileges(false)],
		[D("supported-report-set"), ["addressbook-multiget", "addressbook-query"].map((name) => `<d:supported-report><d:report><card:${name}/></d:report></d:supported-report>`).join("")],
	]);
}

function objectResource(href: string, object: { data: string; etag: string }, contentType: string, dataKey: string, lastModified: Date | null): Resource {
	return {
		href,
		props: new Map<string, string | null>([
			[D("resourcetype"), ""],
			[D("getetag"), escapeXml(object.etag)],
			[D("getcontenttype"), contentType],
			[D("getcontentlength"), String(new TextEncoder().encode(object.data).length)],
			[D("getlastmodified"), lastModified ? lastModified.toUTCString() : null],
			[dataKey, escapeXml(object.data)],
		]),
	};
}

const eventHref = (name: string) => `${DAV_CALENDAR_PATH}${encodeURIComponent(name)}`;
const cardHref = (name: string) => `${DAV_CONTACTS_PATH}${encodeURIComponent(name)}`;

function eventResource(object: EventObject): Resource {
	return objectResource(eventHref(object.name), object, "text/calendar; charset=utf-8; component=VEVENT", CAL("calendar-data"), object.row.updatedAt);
}

function cardResource(object: CardObject): Resource {
	return objectResource(cardHref(object.name), object, "text/vcard; charset=utf-8", CARD("address-data"), object.row.lastSeenAt ?? object.row.createdAt);
}

/** Properties left out of `allprop` because they are large or costly (RFC 4918 §9.1). */
const NOT_IN_ALLPROP = new Set([CAL("calendar-data"), CARD("address-data"), D("supported-report-set"), D("current-user-privilege-set")]);

type PropRequest = { kind: "all" } | { kind: "names" } | { kind: "props"; keys: string[] };

function readPropRequest(root: XmlElement | null): PropRequest {
	if (!root) return { kind: "all" };
	if (child(root, NS.dav, "propname")) return { kind: "names" };
	const prop = child(root, NS.dav, "prop");
	if (!prop) return { kind: "all" };
	return { kind: "props", keys: prop.children.map((item) => clark(item.ns, item.name)) };
}

function responseXml(resource: Resource, request: PropRequest): string {
	const found: string[] = [];
	const missing: string[] = [];
	const keys = request.kind === "props"
		? request.keys
		: [...resource.props.keys()].filter((key) => request.kind === "names" || !NOT_IN_ALLPROP.has(key));
	for (const key of keys) {
		const { ns, name } = parseClark(key);
		const value = resource.props.get(key);
		if (value === undefined || value === null) {
			if (request.kind === "props") missing.push(element(ns, name, null));
			continue;
		}
		found.push(element(ns, name, request.kind === "names" ? null : value));
	}
	const stats: string[] = [];
	if (found.length || !missing.length) stats.push(`<d:propstat><d:prop>${found.join("")}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`);
	if (missing.length) stats.push(`<d:propstat><d:prop>${missing.join("")}</d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`);
	return `<d:response>${hrefXml(resource.href)}${stats.join("")}</d:response>`;
}

function multistatus(parts: string[]): Response {
	return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus ${NAMESPACE_DECLARATIONS}>${parts.join("")}</d:multistatus>`, { status: 207, headers: XML_HEADERS });
}

function notFoundResponse(href: string): string {
	return `<d:response>${hrefXml(href)}<d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
}

// ---------- Methods ----------

async function propfind(ctx: Context, path: DavPath, request: Request): Promise<Response> {
	const body = await readBody(request);
	const root = body.trim() ? parseXml(body) : null;
	if (body.trim() && !root) return new Response("Malformed XML", { status: 400 });
	const props = readPropRequest(root);
	const depth = (request.headers.get("Depth") ?? "1").trim() === "0" ? 0 : 1;
	const resources: Resource[] = [];
	const calendarAllowed = ctx.auth.user.calendarEnabled && (hasScope(ctx.auth.scopes, "calendar:read") || hasScope(ctx.auth.scopes, "calendar:write"));
	const contactsAllowed = hasScope(ctx.auth.scopes, "contacts:read");

	switch (path.kind) {
		case "root":
			resources.push(collectionResource(ctx, `${DAV_BASE}/`, "", "Mailflare"));
			if (depth) resources.push(principalResource(ctx));
			break;
		case "principals":
			resources.push(collectionResource(ctx, `${DAV_BASE}/principals/`, "", "Principals"));
			if (depth) resources.push(principalResource(ctx));
			break;
		case "principal":
			resources.push(principalResource(ctx));
			break;
		case "calendar-home":
			resources.push(collectionResource(ctx, `${DAV_BASE}/calendars/`, "", "Calendars"));
			if (depth && calendarAllowed) resources.push(await calendarResource(ctx));
			break;
		case "contacts-home":
			resources.push(collectionResource(ctx, `${DAV_BASE}/addressbooks/`, "", "Address books"));
			if (depth && contactsAllowed) resources.push(await contactsResource(ctx));
			break;
		case "calendar": {
			const objects = await listEventObjects(ctx);
			resources.push(await calendarResource(ctx, objects));
			if (depth) resources.push(...objects.map(eventResource));
			break;
		}
		case "contacts": {
			const objects = await listCardObjects(ctx);
			resources.push(await contactsResource(ctx, objects));
			if (depth) resources.push(...objects.map(cardResource));
			break;
		}
		case "event": {
			const row = await findEventRow(ctx, path.name);
			if (!row) return new Response("Not found", { status: 404 });
			resources.push(eventResource(await eventObject(row)));
			break;
		}
		case "card": {
			const object = (await listCardObjects(ctx)).find((item) => item.name === path.name);
			if (!object) return new Response("Not found", { status: 404 });
			resources.push(cardResource(object));
			break;
		}
	}
	return multistatus(resources.map((resource) => responseXml(resource, props)));
}

async function report(ctx: Context, path: DavPath, request: Request): Promise<Response> {
	const body = await readBody(request);
	const root = parseXml(body);
	if (!root) return new Response("Malformed XML", { status: 400 });
	const props = readPropRequest(root);
	const kind = `${root.ns} ${root.name}`;

	if (path.kind === "calendar" && (kind === `${NS.caldav} calendar-multiget` || kind === `${NS.caldav} calendar-query`)) {
		const objects = await listEventObjects(ctx);
		if (kind === `${NS.caldav} calendar-multiget`) {
			const byName = new Map(objects.map((object) => [object.name, object]));
			return multistatus(descendants(root, NS.dav, "href").map((item) => {
				const name = hrefToResourceName(item.text.trim(), DAV_CALENDAR_PATH);
				const object = name ? byName.get(name) : undefined;
				return object ? responseXml(eventResource(object), props) : notFoundResponse(item.text.trim());
			}));
		}
		const range = descendants(root, NS.caldav, "time-range")[0];
		const wantsTodos = descendants(root, NS.caldav, "comp-filter").some((filter) => ["VTODO", "VJOURNAL"].includes((filter.attrs.name ?? "").toUpperCase()));
		if (wantsTodos) return multistatus([]);
		const start = range?.attrs.start ? parseUtc(range.attrs.start) : null;
		const end = range?.attrs.end ? parseUtc(range.attrs.end) : null;
		return multistatus(objects
			.filter((object) => timeRangeOverlaps(object.row, start, end))
			.map((object) => responseXml(eventResource(object), props)));
	}

	if (path.kind === "contacts" && (kind === `${NS.carddav} addressbook-multiget` || kind === `${NS.carddav} addressbook-query`)) {
		const objects = await listCardObjects(ctx);
		if (kind === `${NS.carddav} addressbook-multiget`) {
			const byName = new Map(objects.map((object) => [object.name, object]));
			return multistatus(descendants(root, NS.dav, "href").map((item) => {
				const name = hrefToResourceName(item.text.trim(), DAV_CONTACTS_PATH);
				const object = name ? byName.get(name) : undefined;
				return object ? responseXml(cardResource(object), props) : notFoundResponse(item.text.trim());
			}));
		}
		return multistatus(objects.map((object) => responseXml(cardResource(object), props)));
	}

	return forbidden("supported-report");
}

function parseUtc(value: string): Date | null {
	const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
	if (!match) return null;
	const [, y, mo, d, h, mi, s] = match.map(Number);
	const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
	return Number.isFinite(date.getTime()) ? date : null;
}

/** Clients set colors and names on the calendar; nothing here is stored, so every property is refused politely. */
async function proppatch(path: DavPath, request: Request): Promise<Response> {
	const body = await readBody(request);
	const root = parseXml(body);
	if (!root) return new Response("Malformed XML", { status: 400 });
	const href = path.kind === "calendar" ? DAV_CALENDAR_PATH : path.kind === "contacts" ? DAV_CONTACTS_PATH : null;
	if (!href) return forbidden();
	const names = descendants(root, NS.dav, "prop").flatMap((prop) => prop.children.map((item) => element(item.ns, item.name, null)));
	return multistatus([`<d:response>${hrefXml(href)}<d:propstat><d:prop>${names.join("")}</d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response>`]);
}

async function get(ctx: Context, path: DavPath, head: boolean): Promise<Response> {
	let object: { data: string; etag: string } | undefined;
	let contentType = "";
	if (path.kind === "event") {
		const row = await findEventRow(ctx, path.name);
		object = row ? await eventObject(row) : undefined;
		contentType = "text/calendar; charset=utf-8";
	} else if (path.kind === "card") {
		object = (await listCardObjects(ctx)).find((item) => item.name === path.name);
		contentType = "text/vcard; charset=utf-8";
	} else if (path.kind === "calendar" || path.kind === "contacts" || path.kind === "root") {
		return new Response("Mailflare CalDAV/CardDAV. Add this server's address to your calendar or contacts app.", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
	}
	if (!object) return new Response("Not found", { status: 404 });
	return new Response(head ? null : object.data, { status: 200, headers: { "Content-Type": contentType, ETag: object.etag } });
}

function ifMatchFails(request: Request, current: { etag: string } | undefined): boolean {
	const ifMatch = request.headers.get("If-Match");
	const ifNoneMatch = request.headers.get("If-None-Match");
	if (ifNoneMatch?.trim() === "*" && current) return true;
	if (ifMatch) {
		if (!current) return true;
		if (ifMatch.trim() !== "*" && !ifMatch.split(",").map((tag) => tag.trim().replace(/^W\//, "")).includes(current.etag)) return true;
	}
	return false;
}

async function put(ctx: Context, path: DavPath, request: Request): Promise<Response> {
	if (path.kind === "card" || path.kind === "contacts") return forbidden();
	if (path.kind !== "event") return new Response("Method not allowed", { status: 405, headers: { Allow: ALLOW } });
	if (!davAllowsWrite(ctx.auth.scopes)) return forbidden();
	if (!isSafeResourceName(path.name)) return forbidden("valid-calendar-object-resource");

	const body = await readBody(request);
	const existing = await findEventRow(ctx, path.name);
	const current = existing ? await eventObject(existing) : undefined;
	if (ifMatchFails(request, current)) return preconditionFailed();

	const fallbackZone = normalizeTimeZone(ctx.auth.user.timeZone);
	const values = eventValuesFromIcs(body, fallbackZone);
	if ("error" in values) {
		return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<d:error ${NAMESPACE_DECLARATIONS}><cal:valid-calendar-data/><d:responsedescription>${escapeXml(values.error)}</d:responsedescription></d:error>`, { status: 403, headers: XML_HEADERS });
	}

	// RFC 4791 §5.3.2.1 no-uid-conflict: another resource in the calendar already has this UID.
	const ownUid = existing ? eventUid({ id: existing.id, davUid: existing.davUid ?? null }) : null;
	if (values.davUid !== ownUid) {
		const mailflareId = values.davUid.endsWith("@mailflare") ? values.davUid.slice(0, -"@mailflare".length) : null;
		const clash = await ctx.db.select({ id: calendarEvents.id, davName: calendarEvents.davName }).from(calendarEvents).where(and(
			eq(calendarEvents.userId, ctx.auth.userId),
			or(eq(calendarEvents.davUid, values.davUid), mailflareId ? eq(calendarEvents.id, mailflareId) : eq(calendarEvents.davUid, values.davUid)),
			existing ? ne(calendarEvents.id, existing.id) : undefined,
		)).limit(1);
		if (clash.length) {
			const clashHref = eventHref(clash[0].davName ?? `${clash[0].id}.ics`);
			return new Response(`<?xml version="1.0" encoding="utf-8"?>\n<d:error ${NAMESPACE_DECLARATIONS}><cal:no-uid-conflict>${hrefXml(clashHref)}</cal:no-uid-conflict></d:error>`, { status: 409, headers: XML_HEADERS });
		}
	}

	const now = new Date();
	const { davUid, ...columns } = values;
	if (existing) {
		await ctx.db.update(calendarEvents).set({
			...columns,
			// A Mailflare event keeps publishing `<id>@mailflare`; only a client-chosen UID is stored.
			davUid: davUid === ownUid && !existing.davUid ? null : davUid,
			lastRemindedStart: null,
			updatedAt: now,
		}).where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.userId, ctx.auth.userId)));
		// No ETag: what was stored can differ from what was sent (unsupported recurrences, extra properties), so the
		// client must read it back (RFC 4791 §5.3.4).
		return new Response(null, { status: 204 });
	}
	await ctx.db.insert(calendarEvents).values({
		id: newId("evt"),
		userId: ctx.auth.userId,
		mailboxId: null,
		color: "blue",
		...columns,
		davUid,
		davName: path.name,
		createdAt: now,
		updatedAt: now,
	});
	return new Response(null, { status: 201, headers: { Location: eventHref(path.name) } });
}

async function remove(ctx: Context, path: DavPath, request: Request): Promise<Response> {
	if (path.kind === "card" || path.kind === "contacts" || path.kind === "contacts-home") return forbidden();
	if (path.kind !== "event") return forbidden();
	if (!davAllowsWrite(ctx.auth.scopes)) return forbidden();
	const existing = await findEventRow(ctx, path.name);
	if (!existing) return new Response("Not found", { status: 404 });
	if (ifMatchFails(request, await eventObject(existing))) return preconditionFailed();
	await ctx.db.delete(calendarEvents).where(and(eq(calendarEvents.id, existing.id), eq(calendarEvents.userId, ctx.auth.userId)));
	return new Response(null, { status: 204 });
}
