import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(project, "node_modules", "dav-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const load = async (entry, name) => {
	await build({
		entryPoints: [join(project, entry)], outfile: join(directory, name), bundle: true, platform: "node", format: "esm", logLevel: "silent",
		alias: { "@": join(project, "src") },
	});
	return import(pathToFileURL(join(directory, name)).href);
};
const xml = await load("src/lib/dav/xml.ts", "xml.mjs");
const utils = await load("src/lib/dav/utils.ts", "utils.mjs");
const objects = await load("src/lib/dav/objects.ts", "objects.mjs");

test("PROPFIND bodies resolve namespaces by URI, not by prefix", () => {
	const root = xml.parseXml(`<?xml version="1.0"?>
		<A:propfind xmlns:A="DAV:" xmlns:B="urn:ietf:params:xml:ns:caldav" xmlns:C="http://calendarserver.org/ns/">
			<A:prop><A:resourcetype/><B:calendar-home-set/><C:getctag/><X:odd xmlns:X="urn:x"/></A:prop>
		</A:propfind>`);
	assert.equal(root.ns, "DAV:");
	assert.equal(root.name, "propfind");
	const prop = xml.child(root, xml.NS.dav, "prop");
	assert.deepEqual(prop.children.map((item) => xml.clark(item.ns, item.name)), [
		"{DAV:}resourcetype", "{urn:ietf:params:xml:ns:caldav}calendar-home-set", "{http://calendarserver.org/ns/}getctag", "{urn:x}odd",
	]);
});

test("REPORT bodies keep hrefs, entities and time-range attributes", () => {
	const root = xml.parseXml(`<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
		<d:prop><d:getetag/></d:prop><d:href>/dav/calendars/default/a&amp;b.ics</d:href>
		<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="20260101T000000Z" end="20260201T000000Z"/></c:comp-filter></c:comp-filter></c:filter>
	</c:calendar-multiget>`);
	assert.deepEqual(xml.descendants(root, xml.NS.dav, "href").map((item) => item.text), ["/dav/calendars/default/a&b.ics"]);
	assert.equal(xml.descendants(root, xml.NS.caldav, "time-range")[0].attrs.start, "20260101T000000Z");
	assert.equal(xml.parseXml("<a><b></a>"), null);
});

test("paths map to the principal, the two collections and their objects", () => {
	assert.deepEqual(utils.parseDavPath("/dav"), { kind: "root" });
	assert.deepEqual(utils.parseDavPath("/dav/principals/me/"), { kind: "principal" });
	assert.deepEqual(utils.parseDavPath("/dav/calendars/default/"), { kind: "calendar" });
	assert.deepEqual(utils.parseDavPath("/dav/calendars/default/abc%20d.ics"), { kind: "event", name: "abc d.ics" });
	assert.deepEqual(utils.parseDavPath("/dav/addressbooks/default/x.vcf"), { kind: "card", name: "x.vcf" });
	assert.equal(utils.parseDavPath("/dav/calendars/other/"), null);
	assert.equal(utils.parseDavPath("/dav/calendars/default/a/b"), null);
	assert.equal(utils.parseDavPath("/dav/%E0%A4%A"), null);
	assert.equal(utils.isDavPath("/.well-known/caldav"), true);
	assert.equal(utils.isDavPath("/davx"), false);
});

test("resource names stay plain and hrefs resolve relative to their collection", () => {
	assert.equal(utils.isSafeResourceName("5F3A-11.ics"), true);
	assert.equal(utils.isSafeResourceName("../x.ics"), false);
	assert.equal(utils.isSafeResourceName("a b.ics"), false);
	assert.equal(utils.hrefToResourceName("https://mail.example/dav/calendars/default/e1.ics", "/dav/calendars/default/"), "e1.ics");
	assert.equal(utils.hrefToResourceName("/dav/addressbooks/default/e1.vcf", "/dav/calendars/default/"), null);
	assert.equal(utils.eventResourceName({ id: "evt_1", davName: null }), "evt_1.ics");
	assert.equal(utils.eventResourceName({ id: "evt_1", davName: "client.ics" }), "client.ics");
});

test("scopes: any DAV scope signs in, only calendar:write writes", () => {
	assert.equal(utils.davCanRead(["contacts:read"]), true);
	assert.equal(utils.davCanRead(["read", "send"]), false);
	assert.equal(utils.davAllowsWrite(["calendar:read"]), false);
	assert.equal(utils.davAllowsWrite(["calendar:write"]), true);
});

test("time-range keeps series that may still reach the window", () => {
	const at = (iso) => new Date(iso);
	const single = { startsAt: at("2026-03-01T10:00:00Z"), endsAt: at("2026-03-01T11:00:00Z"), repeat: "none", repeatUntil: null };
	assert.equal(utils.timeRangeOverlaps(single, at("2026-03-01T00:00:00Z"), at("2026-03-02T00:00:00Z")), true);
	assert.equal(utils.timeRangeOverlaps(single, at("2026-04-01T00:00:00Z"), null), false);
	const series = { ...single, repeat: "weekly" };
	assert.equal(utils.timeRangeOverlaps(series, at("2027-01-01T00:00:00Z"), at("2027-02-01T00:00:00Z")), true);
	assert.equal(utils.timeRangeOverlaps({ ...series, repeatUntil: at("2026-05-01T00:00:00Z") }, at("2027-01-01T00:00:00Z"), null), false);
});

const event = {
	id: "evt_1", davUid: null, title: "Standup; daily", description: "Line 1\nLine 2", location: "Room, 2",
	startsAt: new Date("2026-03-02T09:00:00Z"), endsAt: new Date("2026-03-02T09:15:00Z"),
	repeat: "weekdays", repeatDays: "[1,2,3,4,5]", repeatAnchorDay: null, repeatUntil: null, excludedOccurrences: "[]",
	timeZone: "Asia/Jakarta", attendees: '["a@example.com"]', updatedAt: new Date("2026-03-01T00:00:00Z"), responseStatus: null, reminderMinutes: 10,
};

test("an event round-trips through its calendar object", () => {
	const ics = objects.buildEventIcs(event, event.updatedAt);
	assert.match(ics, /UID:evt_1@mailflare\r\n/);
	assert.ok(ics.includes("SUMMARY:Standup\\; daily\r\n"));
	assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
	assert.match(ics, /TRIGGER:-PT10M/);
	assert.doesNotMatch(ics, /METHOD:/);
	const values = objects.eventValuesFromIcs(ics, "UTC");
	assert.equal(values.davUid, "evt_1@mailflare");
	assert.equal(values.title, "Standup; daily");
	assert.equal(values.description, "Line 1\nLine 2");
	assert.equal(values.location, "Room, 2");
	assert.equal(values.repeat, "weekdays");
	assert.equal(values.repeatDays, "[1,2,3,4,5]");
	assert.equal(values.timeZone, "Asia/Jakarta");
	assert.equal(values.startsAt.toISOString(), event.startsAt.toISOString());
	assert.equal(values.reminderMinutes, 10);
	assert.equal(values.attendees, '["a@example.com"]');
	assert.equal(objects.buildEventIcs(event, event.updatedAt), ics, "unchanged events have a stable body for their ETag");
});

test("client objects: alarms, unsupported repeats and non-events", () => {
	const ics = [
		"BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:ABC-123", "DTSTART:20260310T100000Z", "DTEND:20260310T110000Z",
		"SUMMARY:Birthday", "RRULE:FREQ=YEARLY", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER;RELATED=START:-P1D", "END:VALARM", "END:VEVENT", "END:VCALENDAR",
	].join("\r\n");
	const values = objects.eventValuesFromIcs(ics, "UTC");
	assert.equal(values.davUid, "ABC-123");
	assert.equal(values.repeat, "none");
	assert.equal(values.reminderMinutes, 1440);
	assert.equal(objects.readAlarmMinutes(ics.replace("-P1D", "PT0S")), 0);
	assert.equal(objects.readAlarmMinutes(ics.replace("TRIGGER;RELATED=START:-P1D", "TRIGGER;VALUE=DATE-TIME:20260309T100000Z")), null);
	assert.ok("error" in objects.eventValuesFromIcs("BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nUID:x\r\nEND:VTODO\r\nEND:VCALENDAR", "UTC"));
	assert.ok("error" in objects.eventValuesFromIcs("not a calendar", "UTC"));
});

test("contacts become vCard 3.0 with escaped names", () => {
	const card = objects.buildContactVcard({ uid: "c1", email: "ana@example.com", displayName: "Ana; Maria Lopez", createdAt: new Date(0), lastSeenAt: null });
	assert.match(card, /^BEGIN:VCARD\r\nVERSION:3\.0\r\n/);
	assert.ok(card.includes("FN:Ana\\; Maria Lopez\r\n"));
	assert.ok(card.includes("N:Lopez;Ana\\; Maria;;;\r\n"));
	assert.match(card, /EMAIL;TYPE=INTERNET:ana@example\.com\r\n/);
});
