"use client";

import { useLanguage } from "@/components/language-provider";
import { Switch } from "@/components/ui/switch";
import { useTwoColumnReading } from "@/components/messages/use-two-column-reading";
import { useAutoAdvanceEnabled } from "@/components/messages/use-auto-advance";
import { useListDensity } from "@/components/messages/use-list-density";
import { isListDensity, LIST_DENSITIES, type ListDensity } from "@/components/messages/list-density-utils";
import { Select } from "@/components/ui/select";
import type { TranslationKey } from "@/lib/i18n/types";

const DENSITY_LABELS: Record<ListDensity, TranslationKey> = {
	compact: "settings.reading.densityCompact",
	default: "settings.reading.densityDefault",
	comfortable: "settings.reading.densityComfortable",
};

export function InboxReadingLayoutSettings() {
	const { t } = useLanguage();
	const [twoColumnReading, setTwoColumnReading] = useTwoColumnReading();
	const [autoAdvance, setAutoAdvance] = useAutoAdvanceEnabled();
	const [density, setDensity] = useListDensity();

	return (
		<div className="space-y-3">
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.reading.densityTitle")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.reading.densityDescription")}
					</span>
				</span>
				<Select
					value={density}
					aria-label={t("settings.reading.densityTitle")}
					className="py-1.5 text-sm text-neutral-900"
					onChange={(event) => {
						const next = event.target.value;
						if (isListDensity(next)) setDensity(next);
					}}
				>
					{LIST_DENSITIES.map((value) => (
						<option key={value} value={value}>
							{t(DENSITY_LABELS[value])}
						</option>
					))}
				</Select>
			</label>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.reading.title")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.reading.description")}
					</span>
				</span>
				<Switch checked={twoColumnReading} onCheckedChange={setTwoColumnReading} aria-label={t("settings.reading.title")} />
			</label>
			<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
				<span className="flex-1">
					<span className="block text-sm font-medium text-neutral-900">{t("settings.reading.autoAdvanceTitle")}</span>
					<span className="mt-1 block text-sm text-neutral-500">
						{t("settings.reading.autoAdvanceDescription")}
					</span>
				</span>
				<Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} aria-label={t("settings.reading.autoAdvanceTitle")} />
			</label>
		</div>
	);
}
