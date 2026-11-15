"use client";

import { useState } from "react";
import { KeyRound } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-current-user";
import { DAV_BASE } from "@/lib/dav/utils";
import { Field } from "./email-clients-settings";
import { createDavApiKey } from "./utils";

/**
 * Settings > App passwords card for phone and desktop calendar and contacts apps (CalDAV/CardDAV).
 * Mints a key with the calendar and contacts scopes; it reaches no mail.
 */
export function CalendarSyncSettings() {
	const { t } = useLanguage();
	const user = useCurrentUser();
	const [name, setName] = useState("");
	const [key, setKey] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const server = `${origin}${DAV_BASE}/`;

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			setKey(await createDavApiKey(name.trim() || t("calendarSync.defaultName")));
			setName("");
		} catch (err) {
			setError(err instanceof Error ? err.message : t("emailClients.createFailed"));
		} finally {
			setBusy(false);
		}
	}

	function copy(label: string, value: string) {
		void navigator.clipboard.writeText(value).then(() => setCopied(label));
	}

	return (
		<div className="space-y-4">
			<div>
				<h2 className="text-base font-semibold text-neutral-900">{t("calendarSync.title")}</h2>
				<p className="mt-1 text-sm text-neutral-500">{t("calendarSync.description")}</p>
			</div>
			{key ? (
				<div className="space-y-3 rounded-2xl bg-neutral-50 p-4">
					<Field label={t("emailClients.server")} value={server} onCopy={copy} copied={copied} />
					<Field label={t("emailClients.username")} value={user?.email ?? t("emailClients.anyValue")} onCopy={copy} copied={copied} />
					<Field label={t("emailClients.passwordApiKey")} value={key} onCopy={copy} copied={copied} mono />
					<p className="text-xs text-neutral-500">{t("calendarSync.shownOnce")}</p>
				</div>
			) : (
				<form onSubmit={submit} className="flex flex-wrap items-end gap-3">
					<div className="min-w-56 flex-1 space-y-2">
						<Label htmlFor="dav-key-name">{t("emailClients.deviceName")}</Label>
						<Input id="dav-key-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("emailClients.devicePlaceholder")} />
					</div>
					<Button type="submit" disabled={busy}>
						<KeyRound className="h-4 w-4" />
						{busy ? t("emailClients.creating") : t("emailClients.create")}
					</Button>
					{error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
				</form>
			)}
			<p className="text-xs text-neutral-500">{t("calendarSync.limits")}</p>
		</div>
	);
}
