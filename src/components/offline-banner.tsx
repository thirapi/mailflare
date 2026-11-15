"use client";

import { WifiOff } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { useOffline } from "@/components/use-offline";

export function OfflineBanner() {
	const { t } = useLanguage();
	if (!useOffline()) return null;
	return (
		<div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">
			<WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
			<span>{t("offline.banner")}</span>
		</div>
	);
}
