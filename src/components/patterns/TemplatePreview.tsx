import { currency } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { PostingAmount } from "../dashboard/tables/PostingAmount";

interface TemplatePreviewProps {
	accounts: Account[];
	postings: Posting[];
	existingAccountIds: string[];
	postingDescriptions: Array<{
		id: string;
		label: string;
		route: string;
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
	const postingById = new Map(postings.map((posting) => [posting.id, posting]));

	return (
		<div className="space-y-3 rounded-xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
			<h4 className="type-eyebrow">
				Preview: {postings.length} posting{postings.length !== 1 ? "s" : ""}
				{newAccounts.length > 0
					? `, ${newAccounts.length} new account${newAccounts.length !== 1 ? "s" : ""}`
					: ""}
			</h4>

			{newAccounts.length > 0 && (
				<div className="space-y-1">
					<span className="type-caption">New accounts:</span>
					<div className="flex flex-wrap gap-1.5">
						{newAccounts.map((a) => (
							<span
								key={a.id}
								className="inline-flex items-center gap-1 rounded-md border border-primary-border bg-primary-subtle px-2 py-0.5 type-caption text-primary"
							>
								<span
									className="h-2 w-2 rounded-full"
									style={{ backgroundColor: a.color ?? "GrayText" }}
								/>
								{a.label}
							</span>
						))}
					</div>
				</div>
			)}

			<div className="space-y-1.5">
				<span className="type-caption">Postings:</span>
				<div className="space-y-1">
					{postingDescriptions.map((p) => (
						<div
							key={p.id}
							className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-border/80 bg-card/85 px-3 py-1.5 type-body dark:border-white/10"
						>
							<span className="type-value/90">{p.label}</span>
							<span className="type-caption">{p.route}</span>
							<div className="rounded bg-muted/80 px-1.5 py-0.5 type-caption">
								{postingById.get(p.id) ? (
									<PostingAmount posting={postingById.get(p.id)!} />
								) : null}
							</div>
							{p.cap && (
								<span className="type-caption text-muted-foreground/70">
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
