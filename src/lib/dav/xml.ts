/**
 * Just enough XML for WebDAV request bodies (RFC 4918, 4791, 6352): elements with
 * namespaces, attributes and text. No DTDs, entities beyond the five predefined ones,
 * or processing instructions, which DAV clients never send. Bodies are capped by the
 * handler before they reach this parser.
 */

export const NS = {
	dav: "DAV:",
	caldav: "urn:ietf:params:xml:ns:caldav",
	carddav: "urn:ietf:params:xml:ns:carddav",
	cs: "http://calendarserver.org/ns/",
	apple: "http://apple.com/ns/ical/",
} as const;

export type XmlElement = {
	ns: string;
	name: string;
	attrs: Record<string, string>;
	children: XmlElement[];
	text: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

export function decodeXmlText(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, entity: string) => {
		if (entity[0] === "#") {
			const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
		}
		return ENTITIES[entity.toLowerCase()] ?? match;
	});
}

export function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Parse an XML document into its root element, or null when it is empty or malformed. */
export function parseXml(source: string): XmlElement | null {
	const text = source.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/gi, "");
	const tag = /<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
	type Frame = { element: XmlElement; prefixes: Record<string, string> };
	const stack: Frame[] = [];
	let root: XmlElement | null = null;
	let last = 0;
	let match: RegExpExecArray | null;
	const resolve = (qualified: string, prefixes: Record<string, string>, isAttribute = false) => {
		const colon = qualified.indexOf(":");
		const prefix = colon >= 0 ? qualified.slice(0, colon) : "";
		const name = colon >= 0 ? qualified.slice(colon + 1) : qualified;
		if (isAttribute && !prefix) return { ns: "", name };
		return { ns: prefixes[prefix] ?? "", name };
	};
	while ((match = tag.exec(text))) {
		const between = text.slice(last, match.index);
		if (stack.length && between) stack[stack.length - 1].element.text += decodeXmlText(between);
		last = tag.lastIndex;
		if (match[5] !== undefined) {
			if (stack.length) stack[stack.length - 1].element.text += match[5];
			continue;
		}
		const [, closing, qualified, rawAttrs, selfClosing] = match;
		if (closing) {
			const frame = stack.pop();
			if (!frame) return null;
			if (!stack.length) root = frame.element;
			continue;
		}
		const prefixes = { ...(stack.at(-1)?.prefixes ?? {}) };
		const attrs: Record<string, string> = {};
		const rawPairs: Array<[string, string]> = [];
		for (const pair of rawAttrs.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
			const value = decodeXmlText(pair[2] ?? pair[3] ?? "");
			if (pair[1] === "xmlns") prefixes[""] = value;
			else if (pair[1].startsWith("xmlns:")) prefixes[pair[1].slice(6)] = value;
			else rawPairs.push([pair[1], value]);
		}
		for (const [key, value] of rawPairs) attrs[resolve(key, prefixes, true).name] = value;
		const { ns, name } = resolve(qualified, prefixes);
		const element: XmlElement = { ns, name, attrs, children: [], text: "" };
		if (stack.length) stack[stack.length - 1].element.children.push(element);
		if (selfClosing) {
			if (!stack.length) root = element;
			continue;
		}
		stack.push({ element, prefixes });
		if (stack.length > 64) return null;
	}
	return stack.length ? null : root;
}

export function child(element: XmlElement | null | undefined, ns: string, name: string): XmlElement | undefined {
	return element?.children.find((item) => item.ns === ns && item.name === name);
}

export function descendants(element: XmlElement | null | undefined, ns: string, name: string): XmlElement[] {
	if (!element) return [];
	const found: XmlElement[] = [];
	const walk = (node: XmlElement) => {
		for (const item of node.children) {
			if (item.ns === ns && item.name === name) found.push(item);
			walk(item);
		}
	};
	walk(element);
	return found;
}

/** A property name as `{namespace}local`, the Clark notation used as map keys. */
export const clark = (ns: string, name: string) => `{${ns}}${name}`;

export function parseClark(value: string): { ns: string; name: string } {
	const end = value.indexOf("}");
	return { ns: value.slice(1, end), name: value.slice(end + 1) };
}

const PREFIXES: Record<string, string> = { [NS.dav]: "d", [NS.caldav]: "cal", [NS.carddav]: "card", [NS.cs]: "cs", [NS.apple]: "ical" };

/** Qualified tag for one of the namespaces declared on every multistatus root. */
export function qname(ns: string, name: string): string {
	const prefix = PREFIXES[ns];
	return prefix ? `${prefix}:${name}` : name;
}

export const NAMESPACE_DECLARATIONS = Object.entries(PREFIXES).map(([ns, prefix]) => `xmlns:${prefix}="${ns}"`).join(" ");
