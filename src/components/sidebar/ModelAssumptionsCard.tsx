import { memo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { FinancialModelDocument } from "@/lib/projection";

interface ModelAssumptionsCardProps {
	document: FinancialModelDocument;
	hasStochasticData: boolean;
}

export const ModelAssumptionsCard = memo(function ModelAssumptionsCard({
	document,
	hasStochasticData,
}: ModelAssumptionsCardProps) {
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
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Model assumptions</CardTitle>
				<CardDescription>
					Compact notes about rates and simplifications.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-3 gap-2 text-center">
					<div className="rounded-xl border border-border/70 bg-surface/70 px-2 py-3 dark:border-white/10 dark:bg-surface/50">
						<div className="type-title">{enabledAccounts}</div>
						<div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground/70">
							Accounts
						</div>
					</div>
					<div className="rounded-xl border border-border/70 bg-surface/70 px-2 py-3 dark:border-white/10 dark:bg-surface/50">
						<div className="type-title">{enabledPostings}</div>
						<div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground/70">
							Flows
						</div>
					</div>
					<div className="rounded-xl border border-border/70 bg-surface/70 px-2 py-3 dark:border-white/10 dark:bg-surface/50">
						<div className="type-title">{document.checkpoints.length}</div>
						<div className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground/70">
							History
						</div>
					</div>
				</div>

				<details className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
					<summary className="cursor-pointer select-none type-eyebrow">
						Annual rates
					</summary>
					{annualRatePostings.length > 0 ? (
						<div className="mt-3 space-y-2 type-body">
							{annualRatePostings.map((posting) => (
								<div
									key={posting.id}
									className="grid grid-cols-[1fr_auto] gap-3"
								>
									<span className="text-foreground/80">{posting.label}</span>
									<span className="text-right text-muted-foreground">
										{(posting.annualRate * 100).toFixed(1)}%
										{posting.annualGrowthRate > 0
											? `, +${(posting.annualGrowthRate * 100).toFixed(1)}%/yr`
											: ""}
										{posting.volatility > 0
											? `, +/-${(posting.volatility * 100).toFixed(1)}%`
											: ""}
									</span>
								</div>
							))}
						</div>
					) : (
						<div className="mt-2 type-muted text-muted-foreground/70">
							No annual rates configured on enabled transactions.
						</div>
					)}
				</details>

				<details className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
					<summary className="cursor-pointer select-none type-eyebrow">
						Model boundaries
					</summary>
					<ul className="mt-3 space-y-1 type-caption">
						<li>Taxes are modeled as a flat percentage of income.</li>
						<li>
							Investment returns, loan rates, and expense growth are annual
							rates converted to monthly.
						</li>
						<li>
							Inflation is not explicitly modeled; values are nominal dollars.
						</li>
						<li>
							Salary growth, expense growth, and loan rates stay fixed unless
							edited in the model inputs.
						</li>
					</ul>
				</details>

				{hasStochasticData ? (
					<div className="type-caption text-muted-foreground/70">
						Monte Carlo bands are based on the volatile transactions configured
						in the input data.
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});
