const STORAGE_KEY = "mailflare-ascii-animation";
export const ASCII_ANIMATION_CHANGED_EVENT = "mailflare:ascii-animation-changed";
/** Fallback when storage is unavailable (private windows), so the switch still works for this page. */
let memoryValue: boolean | null = null;

/** Decorative animations are on unless turned off in Settings → Inbox; stored per browser. */
export function readAsciiAnimationEnabled(): boolean {
	if (memoryValue !== null) return memoryValue;
	try {
		return localStorage.getItem(STORAGE_KEY) !== "off";
	} catch {
		return true;
	}
}

export function saveAsciiAnimationEnabled(enabled: boolean): void {
	memoryValue = enabled;
	try {
		if (enabled) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, "off");
	} catch {
		// The choice still applies until the page is closed.
	}
	window.dispatchEvent(new Event(ASCII_ANIMATION_CHANGED_EVENT));
}
