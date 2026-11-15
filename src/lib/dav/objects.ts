import { dateProperty, recurrenceRule, validTimeZone, type FeedEvent } from "@/lib/calendar/feed";
import { escapeIcsText, formatIcsUtc, ICS_ADDRESS, joinIcsLines } from "@/lib/calendar/ics";
import { inviteRepeat, parseIcsDuration, parseInvite } from "@/lib/calendar/invite";
import { mergeExcludedOccurrences } from "@/lib/calendar/invite-rules";
import { parseExcludedOccurrences } from "@/lib/calendar/recurrence";
import { normalizeReminderMinutes } from "@/lib/calendar/reminder-utils";

export type DavEvent = FeedEvent & {
	davUid: string | null;
	reminderMinutes: number | null;
	color?: string | null;
};

export type DavContact = {
	/** Stable vCard UID; the handler passes the resource name's digest so the internal id stays private. */
	uid: string;
	email: string;
	displayName: string | null;
	createdAt: Date;
	lastSeenAt: Date | null;
};

/** The iCalendar UID of an event: the client's own, or the one the feed has always published. */
export function eventUid(event: { id: string; davUid: string | null }): string {
	return event.davUid ?? `${event.id}@mailflare`;
}

/** One VEVENT in its own VCALENDAR, the shape of a CalDAV calendar object resource (RFC 4791 §4.1). */
export function buildEventIcs(event: DavEvent, now = new Date()): string {
	const rule = recurrenceRule(event);
	const zone = rule ? validTimeZone(event.timeZone) : null;
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mailflare//CalDAV//EN", "CALSCALE:GREGORIAN",
		"BEGIN:VEVENT", `UID:${eventUid(event)}`, `DTSTAMP:${formatIcsUtc(now)}`,
		dateProperty("DTSTART", event.startsAt, zone), dateProperty("DTEND", event.endsAt, zone),
		`SUMMARY:${escapeIcsText(event.title)}`];
	if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
	if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
	if (rule) {
		lines.push(rule);
		for (const excluded of parseExcludedOccurrences(event.excludedOccurrences)) lines.push(dateProperty("EXDATE", new Date(excluded), zone));
	}
	for (const attendee of parseAttendees(event.attendees)) lines.push(`ATTENDEE;RSVP=TRUE:mailto:${attendee}`);
	if (event.responseStatus === "tentative") lines.push("STATUS:TENTATIVE");
	if (event.updatedAt) lines.push(`LAST-MODIFIED:${formatIcsUtc(event.updatedAt)}`);
	if (event.reminderMinutes !== null && event.reminderMinutes !== undefined) {
		lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(event.title)}`,
			`TRIGGER:${event.reminderMinutes === 0 ? "PT0S" : `-PT${event.reminderMinutes}M`}`, "END:VALARM");
	}
	lines.push("END:VEVENT", "END:VCALENDAR");
	return joinIcsLines(lines);
}

function parseAttendees(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && ICS_ADDRESS.test(item)) : [];
	} catch {
		return [];
	}
}

/**
 * Minutes before the start of the first display alarm in the main VEVENT, or null. Only alarms relative to the start
 * (`TRIGGER:-PT15M`, `TRIGGER;RELATED=START:-P1D`) map onto Mailflare's single reminder.
 */
export function readAlarmMinutes(text: string): number | null {
	const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
	let depth = 0;
	let inEvent = false;
	let inAlarm = false;
	for (const raw of lines) {
		const line = raw.trim();
		const upper = line.toUpperCase();
		if (upper.startsWith("BEGIN:")) {
			const component = upper.slice(6);
			if (!inEvent && component === "VEVENT") { inEvent = true; depth = 0; continue; }
			if (inEvent) {
				depth++;
				if (component === "VALARM" && depth === 1) inAlarm = true;
			}
			continue;
		}
		if (upper.startsWith("END:")) {
			if (!inEvent) continue;
			if (depth === 0) return null;
			if (inAlarm && depth === 1) inAlarm = false;
			depth--;
			continue;
		}
		if (!inAlarm || !upper.startsWith("TRIGGER")) continue;
		const colon = line.indexOf(":");
		const params = line.slice(0, colon).toUpperCase();
		if (colon < 0 || params.includes("VALUE=DATE-TIME") || params.includes("RELATED=END")) continue;
		const value = line.slice(colon + 1).trim();
		const negative = value.startsWith("-");
		const duration = parseIcsDuration(value.replace(/^[-+]/, ""));
		if (/^[-+]?PT?0[SMHDW]?$/i.test(value)) return 0;
		if (!duration || !negative) continue;
		return normalizeReminderMinutes(Math.round((duration.days * 86_400_000 + duration.ms) / 60_000));
	}
	return null;
}

export type DavEventValues = {
	davUid: string;
	title: string;
	description: string;
	location: string;
	attendees: string;
	repeat: FeedEvent["repeat"];
	repeatDays: string;
	repeatAnchorDay: number | null;
	repeatUntil: Date | null;
	excludedOccurrences: string;
	timeZone: string | null;
	startsAt: Date;
	endsAt: Date;
	reminderMinutes: number | null;
};

/**
 * Calendar columns from a client's calendar object. Recurrences Mailflare cannot store (yearly, every other week,
 * "second Tuesday") become one-off events; the PUT answers without an ETag so the client re-reads what was kept.
 */
export function eventValuesFromIcs(text: string, fallbackZone: string | null): DavEventValues | { error: string } {
	if (!/BEGIN:VCALENDAR/i.test(text) || !/BEGIN:VEVENT/i.test(text)) return { error: "Only VEVENT calendar objects are supported" };
	if (/BEGIN:VTODO|BEGIN:VJOURNAL/i.test(text)) return { error: "Only VEVENT calendar objects are supported" };
	const parsed = parseInvite(text, { timeZone: fallbackZone });
	if (!parsed) return { error: "The calendar object could not be read" };
	const timeZone = parsed.timeZone ?? fallbackZone;
	const repeat = inviteRepeat(parsed.rrule, parsed.startsAt, timeZone);
	const attendees = parsed.attendees
		.map((attendee) => attendee.email)
		.filter((email) => ICS_ADDRESS.test(email) && email !== parsed.organizer?.toLowerCase());
	return {
		davUid: parsed.uid,
		title: parsed.title,
		description: parsed.description,
		location: parsed.location,
		attendees: JSON.stringify([...new Set(attendees)].slice(0, 100)),
		repeat: repeat.repeat,
		repeatDays: JSON.stringify(repeat.repeatDays),
		repeatAnchorDay: repeat.repeatAnchorDay,
		repeatUntil: repeat.repeatUntil,
		excludedOccurrences: repeat.repeat === "none" ? "[]" : mergeExcludedOccurrences("[]", parsed.excludedDates),
		timeZone,
		startsAt: parsed.startsAt,
		endsAt: parsed.endsAt,
		reminderMinutes: readAlarmMinutes(text),
	};
}

function escapeVcard(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** A vCard 3.0 (RFC 2426), the version every CardDAV client reads. */
export function buildContactVcard(contact: DavContact): string {
	const name = contact.displayName?.trim() || contact.email;
	const parts = name.split(/\s+/);
	const family = parts.length > 1 ? parts.at(-1)! : "";
	const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
	const lines = ["BEGIN:VCARD", "VERSION:3.0", "PRODID:-//Mailflare//CardDAV//EN", `UID:${contact.uid}`,
		`FN:${escapeVcard(name)}`, `N:${escapeVcard(family)};${escapeVcard(given)};;;`,
		`EMAIL;TYPE=INTERNET:${escapeVcard(contact.email)}`,
		`REV:${formatIcsUtc(contact.lastSeenAt ?? contact.createdAt)}`, "END:VCARD"];
	return joinIcsLines(lines);
}
