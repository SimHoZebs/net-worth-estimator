import { Metric, SectionCard } from "@/components/present/Present";
import { formatPercentRate } from "@/lib/format";
import { useModelRuntime } from "@/runtime/modelRuntime";

export function ModelAssumptionsCard() {
	const { document: canonicalDocument, effectiveDocument } = useModelRuntime();
	const document = effectiveDocument ?? canonicalDocument;
	if (!document) return null;
	const enabledAccounts = document.accounts.filter(
		(account) => account.enabled,
	).length;
	const enabledPostings = document.postings.filter(
		(posting) => posting.enabled,
	).length;
	const annualRatePostings = document.postings.filter(
		(posting) => posting.enabled && posting.annualRate > 0,
	);

	return (
		<SectionCard
			title="Assumptions"
			className="rounded-[1.4rem] border-border/80"
			contentClassName="space-y-4"
		>
			<div className="grid grid-cols-2 gap-2 text-center">
				<Metric
					size="sm"
					label="Accounts"
					value={enabledAccounts}
					className="border-0 px-2 py-3 dark:bg-surface/50"
					labelClassName="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground/70"
					valueClassName="mt-1 type-title"
				/>
				<Metric
					size="sm"
					label="Flows"
					value={enabledPostings}
					className="border-0 px-2 py-3 dark:bg-surface/50"
					labelClassName="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground/70"
					valueClassName="mt-1 type-title"
				/>
			</div>

			<details className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
				<summary className="cursor-pointer select-none type-eyebrow">
					Rates
				</summary>
				{annualRatePostings.length > 0 ? (
					<div className="mt-3 space-y-2 type-body">
						{annualRatePostings.map((posting) => (
							<div key={posting.id} className="grid grid-cols-[1fr_auto] gap-3">
								<span className="text-foreground/80">{posting.label}</span>
								<span className="text-right text-muted-foreground">
									{formatPercentRate(posting.annualRate)}
									{posting.annualGrowthRate > 0
										? `, +${formatPercentRate(posting.annualGrowthRate)}/yr`
										: ""}
									{posting.volatility > 0
										? `, +/-${formatPercentRate(posting.volatility)}`
										: ""}
								</span>
							</div>
						))}
					</div>
				) : (
					<div className="mt-2 type-muted text-muted-foreground/70">None.</div>
				)}
			</details>
		</SectionCard>
	);
}
