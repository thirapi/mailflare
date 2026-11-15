import Link from "next/link";
import { AsciiArt } from "@/components/ascii/ascii-art";
import { getServerTranslator } from "@/lib/i18n/server";

export default async function NotFound() {
	const t = await getServerTranslator();
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f6f8fc] px-4 text-center">
			<AsciiArt scene="not-found" rows={13} maxCols={64} className="w-full max-w-2xl" />
			<h1 className="text-xl font-semibold text-neutral-900">{t("notFound.title")}</h1>
			<p className="max-w-md text-sm text-neutral-500">{t("notFound.description")}</p>
			<Link href="/inbox" className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700">
				{t("notFound.back")}
			</Link>
		</main>
	);
}
