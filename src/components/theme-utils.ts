export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "mailflare-theme";
export const THEME_CHANGED_EVENT = "mailflare:theme-changed";

// Runs in <head> before paint, so the first frame already has the right theme (same approach as the
// sidebar width). Keep it in sync with resolveTheme/applyTheme below.
export const themeBootstrapScript = `(() => {
	try {
		const saved = localStorage.getItem("mailflare-theme");
		const preference = saved === "light" || saved === "dark" ? saved : "system";
		const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
		document.documentElement.classList.toggle("light", !dark);
		if (localStorage.getItem("mailflare-style") === "violet") document.documentElement.dataset.style = "violet";
	} catch {}
})();`;

/** Visual style, independent of light/dark: "classic" is the default look, "violet" a violet accent with a dark sidebar. */
export type StylePreference = "classic" | "violet";

export const STYLE_STORAGE_KEY = "mailflare-style";
export const STYLE_CHANGED_EVENT = "mailflare:style-changed";

export function isStylePreference(value: unknown): value is StylePreference {
	return value === "classic" || value === "violet";
}

export function readStylePreference(): StylePreference {
	if (typeof window === "undefined") return "classic";
	try {
		const saved = localStorage.getItem(STYLE_STORAGE_KEY);
		return isStylePreference(saved) ? saved : "classic";
	} catch {
		return "classic";
	}
}

/** Sets `data-style` on <html>; globals.css keys the violet palette off it. Keep in sync with themeBootstrapScript. */
export function applyStyle(preference: StylePreference): void {
	if (typeof document === "undefined") return;
	if (preference === "classic") delete document.documentElement.dataset.style;
	else document.documentElement.dataset.style = preference;
}

export function saveStylePreference(preference: StylePreference): void {
	try {
		if (preference === "classic") localStorage.removeItem(STYLE_STORAGE_KEY);
		else localStorage.setItem(STYLE_STORAGE_KEY, preference);
	} catch {
		// Storage can be unavailable in private windows; the style still applies for this page.
	}
	applyStyle(preference);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STYLE_CHANGED_EVENT, { detail: preference }));
}

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "system";
	try {
		const saved = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(saved) ? saved : "system";
	} catch {
		return "system";
	}
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference !== "system") return preference;
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
	if (typeof document === "undefined") return;
	const dark = resolveTheme(preference) === "dark";
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.classList.toggle("light", !dark);
}

export function saveThemePreference(preference: ThemePreference): void {
	try {
		if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
		else localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Storage can be unavailable in private windows; the theme still applies for this page.
	}
	applyTheme(preference);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: preference }));
}
