import { memo, useState } from "react";
import { AssumptionList } from "@/components/dashboard/AssumptionList";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatCurrencyInput, formatDate } from "@/lib/format";
import type { ProjectionRuntimeSettings, ScenarioPack } from "@/lib/projection";

interface KeyAssumptionsCardProps {
	pack: ScenarioPack;
	onTargetNetWorthChange: (value: number) => void;
	projectionSettings: ProjectionRuntimeSettings;
	onProjectionSettingsChange?: (
		partial: Partial<ProjectionRuntimeSettings>,
	) => void;
	activeOverrideCount: number;
	projectionStartDate: string;
	hasStochasticData: boolean;
}

export const KeyAssumptionsCard = memo(function KeyAssumptionsCard({
	pack,
	onTargetNetWorthChange,
	projectionSettings,
	onProjectionSettingsChange,
	activeOverrideCount,
	projectionStartDate,
	hasStochasticData,
}: KeyAssumptionsCardProps) {
	const [isTargetFocused, setIsTargetFocused] = useState(false);
	const [targetDraft, setTargetDraft] = useState(
		String(projectionSettings.targetNetWorth),
	);

	const commitTargetNetWorth = () => {
		const nextTarget = Number(targetDraft);
		if (Number.isFinite(nextTarget)) {
			onTargetNetWorthChange(nextTarget);
		}
		setIsTargetFocused(false);
	};

	return (
		<Card className="rounded-[1.6rem] border-border/80">
			<CardHeader>
				<div>
					<CardTitle>Key assumptions</CardTitle>
					<CardDescription>
						The scheduled transactions and settings that drive this projection.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<div className="mb-5 grid gap-4 sm:grid-cols-3">
					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-eyebrow">Target net worth</div>
						{isTargetFocused ? (
							<input
								type="number"
								inputMode="numeric"
								step={1000}
								value={targetDraft}
								onChange={(event) => setTargetDraft(event.currentTarget.value)}
								onBlur={commitTargetNetWorth}
								onKeyDown={(event) => {
									if (event.key === "Enter") commitTargetNetWorth();
									if (event.key === "Escape") {
										setTargetDraft(String(projectionSettings.targetNetWorth));
										setIsTargetFocused(false);
									}
								}}
								className="mt-2 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 type-title shadow-sm outline-none transition focus:border-ring dark:border-white/10"
							/>
						) : (
							<button
								type="button"
								onClick={() => {
									setTargetDraft(String(projectionSettings.targetNetWorth));
									setIsTargetFocused(true);
								}}
								className="mt-2 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-left type-title shadow-sm outline-none transition hover:border-ring focus:border-ring dark:border-white/10"
							>
								{formatCurrencyInput(String(projectionSettings.targetNetWorth))}
							</button>
						)}
						<div className="mt-1 type-caption text-muted-foreground/70">
							Nominal dollars
						</div>
					</div>
					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="flex items-center justify-between">
							<div className="type-eyebrow">Projection horizon</div>
							<span className="type-title">
								{projectionSettings.horizonYears} yr
							</span>
						</div>
						<input
							type="range"
							min={5}
							max={50}
							step={1}
							value={projectionSettings.horizonYears}
							onChange={(e) => {
								onProjectionSettingsChange?.({
									horizonYears: Number(e.target.value),
								});
							}}
							className="mt-2 w-full accent-primary"
						/>
						<div className="mt-1 type-caption text-muted-foreground/70">
							From {formatDate(projectionStartDate)}
						</div>
					</div>
					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-eyebrow">Overrides</div>
						<div className="mt-2 type-title">
							{activeOverrideCount === 0 ? "None" : String(activeOverrideCount)}
						</div>
						<div className="mt-1 type-caption text-muted-foreground/70">
							{activeOverrideCount === 0
								? "Baseline only"
								: "Temporary scenario changes"}
						</div>
					</div>
				</div>

				<AssumptionList pack={pack} />

				<div className="mt-4 border-t border-border/70 pt-4">
					<div className="flex flex-wrap gap-x-6 gap-y-2 type-muted">
						<span>
							<span className="type-value">
								{pack.accounts.filter((a) => a.enabled).length}
							</span>{" "}
							accounts tracked
						</span>
						<span>
							<span className="type-value">
								{pack.postings.filter((p) => p.enabled).length}
							</span>{" "}
							scheduled transactions
						</span>
						<span>
							<span className="type-value">{pack.checkpoints.length}</span>{" "}
							balance history points
						</span>
					</div>
				</div>

				<div className="mt-4 rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
					<div className="type-label tracking-wide">Annual rates</div>
					{pack.postings.filter((p) => p.enabled && p.annualRate > 0).length >
					0 ? (
						<div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-6 gap-y-1 type-body">
							{pack.postings
								.filter((p) => p.enabled && p.annualRate > 0)
								.map((p) => (
									<div key={p.id} className="contents">
										<span className="text-foreground/80">{p.label}:</span>
										<span className="text-muted-foreground/70 italic">
											{p.annualGrowthRate > 0
												? `${(p.annualRate * 100).toFixed(1)}%, growing ${(p.annualGrowthRate * 100).toFixed(1)}%/yr`
												: `${(p.annualRate * 100).toFixed(1)}%`}
										</span>
										<span className="text-right text-muted-foreground">
											{p.volatility > 0
												? `±${(p.volatility * 100).toFixed(1)}%`
												: "Fixed"}
										</span>
									</div>
								))}
						</div>
					) : (
						<div className="mt-1 type-muted text-muted-foreground/70">
							No annual rates configured on enabled transactions.
						</div>
					)}
				</div>

				<div className="mt-4 space-y-2 rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
					<div className="type-eyebrow">Model assumptions</div>
					<ul className="space-y-1 type-caption">
						<li>
							Taxes are modeled as a flat percentage of income — progressive
							brackets, deductions, and credits are not included.
						</li>
						<li>
							Investment returns, loan rates, and expense growth are treated as
							annual rates, converted to monthly in the projection.
						</li>
						<li>
							Inflation is not explicitly modeled. All values are in nominal
							dollars unless otherwise specified.
						</li>
						<li>
							Salary growth, expense growth, and loan rates are fixed at the
							values shown — they do not vary automatically with inflation or
							market conditions.
						</li>
					</ul>
				</div>
				{hasStochasticData ? (
					<div className="mt-3 type-caption text-muted-foreground/70">
						Monte Carlo simulation enabled. This depends on the assumptions
						above and is not a guarantee.
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});
