"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

const readOnline = () => navigator.onLine;
const serverOnline = () => true;

export function OfflineBanner() {
	const { t } = useLanguage();
	const online = useSyncExternalStore(subscribe, readOnline, serverOnline);
	if (online) return null;
	return (
		<div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">
			<WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
			<span>{t("offline.banner")}</span>
		</div>
	);
}
