import { currency } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";

interface TemplatePreviewProps {
	accounts: Account[];
	postings: Posting[];
	existingAccountIds: string[];
	postingDescriptions: Array<{
		id: string;
		label: string;
		route: string;
		arithmetic: string;
		cap: string;
	}>;
}

export function TemplatePreview({
	accounts,
	postings,
	existingAccountIds,
	postingDescriptions,
}: TemplatePreviewProps) {
	const existingSet = new Set(existingAccountIds);
	const newAccounts = accounts.filter((a) => !existingSet.has(a.id));

	return (
		<div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3">
			<h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
				Preview: {postings.length} posting{postings.length !== 1 ? "s" : ""}
				{newAccounts.length > 0
					? `, ${newAccounts.length} new account${newAccounts.length !== 1 ? "s" : ""}`
					: ""}
			</h4>

			{newAccounts.length > 0 && (
				<div className="space-y-1">
					<span className="text-xs text-slate-500 dark:text-slate-400">
						New accounts:
					</span>
					<div className="flex flex-wrap gap-1.5">
						{newAccounts.map((a) => (
							<span
								key={a.id}
								className="inline-flex items-center gap-1 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950 px-2 py-0.5 text-xs text-green-800 dark:text-green-400"
							>
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: a.color ?? "#64748b" }}
								/>
								{a.label}
							</span>
						))}
					</div>
				</div>
			)}

			<div className="space-y-1.5">
				<span className="text-xs text-slate-500 dark:text-slate-400">
					Postings:
				</span>
				<div className="space-y-1">
					{postingDescriptions.map((p) => (
						<div
							key={p.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm"
						>
							<span className="font-medium text-slate-800 dark:text-slate-200">
								{p.label}
							</span>
							<span className="text-xs text-slate-500 dark:text-slate-400">
								{p.route}
							</span>
							<code className="text-xs text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700/80 rounded px-1.5 py-0.5">
								{p.arithmetic}
							</code>
							{p.cap && (
								<span className="text-xs text-slate-400 dark:text-slate-500">
									{p.cap}
								</span>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

export function describePostingRoute(
	posting: Posting,
	accounts: Account[],
): string {
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const src = posting.sourceAccountId
		? (byId.get(posting.sourceAccountId)?.label ?? posting.sourceAccountId)
		: "External";
	const dst =
		posting.destinations === null
			? "External"
			: posting.destinations.map((d) => byId.get(d)?.label ?? d).join(" ; ");
	return `${src} \u2192 ${dst}`;
}

export function describePostingCap(posting: Posting): string {
	if (!posting.annualCap) return "";
	return `cap: ${currency.format(posting.annualCap)}/yr`;
}
