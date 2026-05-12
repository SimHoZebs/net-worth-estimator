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
		<Card className="rounded-[1.6rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
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
					<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
						<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
							Target net worth
						</div>
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
								className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xl font-semibold text-slate-900 dark:text-slate-100 shadow-sm dark:shadow-slate-900/30 outline-none transition focus:border-slate-400 dark:focus:border-slate-500"
							/>
						) : (
							<button
								type="button"
								onClick={() => {
									setTargetDraft(String(projectionSettings.targetNetWorth));
									setIsTargetFocused(true);
								}}
								className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-left text-xl font-semibold text-slate-900 dark:text-slate-100 shadow-sm dark:shadow-slate-900/30 outline-none transition hover:border-slate-300 dark:hover:border-slate-600 focus:border-slate-400 dark:focus:border-slate-500"
							>
								{formatCurrencyInput(String(projectionSettings.targetNetWorth))}
							</button>
						)}
						<div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
							Nominal dollars
						</div>
					</div>
					<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
						<div className="flex items-center justify-between">
							<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
								Projection horizon
							</div>
							<span className="text-lg font-semibold text-slate-900 dark:text-slate-100">
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
							className="mt-2 w-full accent-slate-900"
						/>
						<div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
							From {formatDate(projectionStartDate)}
						</div>
					</div>
					<div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
						<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
							Overrides
						</div>
						<div className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-100">
							{activeOverrideCount === 0 ? "None" : String(activeOverrideCount)}
						</div>
						<div className="mt-1 text-xs text-slate-400 dark:text-slate-500">
							{activeOverrideCount === 0
								? "Baseline only"
								: "Temporary scenario changes"}
						</div>
					</div>
				</div>

				<AssumptionList pack={pack} />

				<div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-4">
					<div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
						<span>
							<span className="font-medium text-slate-900 dark:text-slate-100">
								{pack.accounts.filter((a) => a.enabled).length}
							</span>{" "}
							accounts tracked
						</span>
						<span>
							<span className="font-medium text-slate-900 dark:text-slate-100">
								{pack.postings.filter((p) => p.enabled).length}
							</span>{" "}
							scheduled transactions
						</span>
						<span>
							<span className="font-medium text-slate-900 dark:text-slate-100">
								{pack.checkpoints.length}
							</span>{" "}
							balance history points
						</span>
					</div>
				</div>

				<div className="mt-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
					<div className="text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">
						Annual rates
					</div>
					{pack.postings.filter((p) => p.enabled && p.annualRate > 0).length >
					0 ? (
						<div className="mt-2 grid grid-cols-[auto_1fr_auto] gap-x-6 gap-y-1 text-sm">
							{pack.postings
								.filter((p) => p.enabled && p.annualRate > 0)
								.map((p) => (
									<div key={p.id} className="contents">
										<span className="text-slate-700 dark:text-slate-300">
											{p.label}:
										</span>
										<span className="text-slate-400 dark:text-slate-500 italic">
											{p.annualGrowthRate > 0
												? `${(p.annualRate * 100).toFixed(1)}%, growing ${(p.annualGrowthRate * 100).toFixed(1)}%/yr`
												: `${(p.annualRate * 100).toFixed(1)}%`}
										</span>
										<span className="text-right text-slate-500 dark:text-slate-400">
											{p.volatility > 0
												? `±${(p.volatility * 100).toFixed(1)}%`
												: "Fixed"}
										</span>
									</div>
								))}
						</div>
					) : (
						<div className="mt-1 text-sm text-slate-400 dark:text-slate-500">
							No annual rates configured on enabled transactions.
						</div>
					)}
				</div>

				<div className="mt-4 space-y-2 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
					<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
						Model assumptions
					</div>
					<ul className="space-y-1 text-xs text-slate-600 dark:text-slate-400">
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
					<div className="mt-3 text-xs text-slate-400 dark:text-slate-500">
						Monte Carlo simulation enabled. This depends on the assumptions
						above and is not a guarantee.
					</div>
				) : null}
			</CardContent>
		</Card>
	);
});
