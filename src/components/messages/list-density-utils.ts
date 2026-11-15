export type ListDensity = "compact" | "default" | "comfortable";

export const LIST_DENSITY_STORAGE_KEY = "mailflare-list-density";
export const LIST_DENSITY_CHANGE_EVENT = "mailflare:list-density-changed";
export const LIST_DENSITIES: readonly ListDensity[] = ["compact", "default", "comfortable"];

export function isListDensity(value: unknown): value is ListDensity {
	return value === "compact" || value === "default" || value === "comfortable";
}

export function parseListDensity(value: unknown): ListDensity {
	return isListDensity(value) ? value : "default";
}

/** Row height for the wide (table-like) message list. */
export function wideRowHeightClass(density: ListDensity): string {
	if (density === "compact") return "min-h-9";
	if (density === "comfortable") return "min-h-14";
	return "min-h-12";
}

/** Vertical padding for the narrow (stacked) message list. */
export function narrowRowPaddingClass(density: ListDensity): string {
	if (density === "compact") return "py-1.5";
	if (density === "comfortable") return "py-4";
	return "py-3";
}

/** The narrow list drops the preview line in compact density so more rows fit. */
export function showsNarrowPreview(density: ListDensity): boolean {
	return density !== "compact";
}
