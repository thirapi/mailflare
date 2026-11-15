"use client";

import { useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { Select } from "@/components/ui/select";
import {
	isStylePreference,
	isThemePreference,
	readStylePreference,
	readThemePreference,
	saveStylePreference,
	saveThemePreference,
	STYLE_CHANGED_EVENT,
	THEME_CHANGED_EVENT,
	type StylePreference,
	type ThemePreference,
} from "@/components/theme-utils";

const OPTIONS: { value: ThemePreference; labelKey: TranslationKey }[] = [
	{ value: "system", labelKey: "settings.theme.system" },
	{ value: "light", labelKey: "settings.theme.light" },
	{ value: "dark", labelKey: "settings.theme.dark" },
];

function subscribeThemePreference(onChange: () => void) {
	window.addEventListener(THEME_CHANGED_EVENT, onChange);
	return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
}

const serverThemePreference = (): ThemePreference => "system";

const STYLE_OPTIONS: { value: StylePreference; labelKey: TranslationKey }[] = [
	{ value: "classic", labelKey: "settings.style.classic" },
	{ value: "violet", labelKey: "settings.style.violet" },
];

function subscribeStylePreference(onChange: () => void) {
	window.addEventListener(STYLE_CHANGED_EVENT, onChange);
	return () => window.removeEventListener(STYLE_CHANGED_EVENT, onChange);
}

const serverStylePreference = (): StylePreference => "classic";

export function AppearanceSettings() {
	const { t } = useLanguage();
	const preference = useSyncExternalStore(subscribeThemePreference, readThemePreference, serverThemePreference);
	const style = useSyncExternalStore(subscribeStylePreference, readStylePreference, serverStylePreference);

	return (
		<div className="space-y-3">
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.theme.label")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.theme.description")}
					</span>
				</span>
				<Select
					value={preference}
					aria-label={t("settings.theme.label")}
					className="py-1.5 text-sm text-neutral-900"
					onChange={(event) => {
						const next = event.target.value;
						if (!isThemePreference(next)) return;
						saveThemePreference(next);
					}}
				>
					{OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{t(option.labelKey)}
						</option>
					))}
				</Select>
			</label>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.style.label")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.style.description")}
					</span>
				</span>
				<Select
					value={style}
					aria-label={t("settings.style.label")}
					className="py-1.5 text-sm text-neutral-900"
					onChange={(event) => {
						const next = event.target.value;
						if (!isStylePreference(next)) return;
						saveStylePreference(next);
					}}
				>
					{STYLE_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{t(option.labelKey)}
						</option>
					))}
				</Select>
			</label>
		</div>
	);
}
