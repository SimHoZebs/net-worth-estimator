import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { useDebouncedStochasticConfig } from "@/hooks/useDebouncedStochasticConfig";
import { currency, formatDate, pct } from "@/lib/format";
import type { StochasticProjectionResult } from "@/lib/projection";
import { useStore } from "@/store";
import { StochasticResultCard } from "./dashboard/StochasticResultCard";

interface StochasticControlsProps {
	hasStochasticAccounts: boolean;
	isRunning: boolean;
	progress: number | null;
	stochasticResult: StochasticProjectionResult | null;
	compact?: boolean;
}

export function StochasticControls({
	hasStochasticAccounts,
	isRunning,
	progress,
	stochasticResult,
}: StochasticControlsProps) {
	const stochasticPreference = useStore((s) => s.stochasticPreference);
	const config = useStore((s) => s.stochasticConfig);
	const onPreferenceChange = useStore((s) => s.setStochasticPreference);
	const onConfigChange = useStore((s) => s.setStochasticConfig);
	const simulationRequested = stochasticPreference !== "disabled";
	const simulationActive = simulationRequested && hasStochasticAccounts;

	const {
		runCountInput,
		seedInput,
		hasPendingChanges,
		updateRunCountInput,
		updateSeedInput,
		applyImmediately,
	} = useDebouncedStochasticConfig(config, onConfigChange);

	const progressPct = progress !== null ? Math.round(progress * 100) : null;
	const statusLabel = isRunning
		? progressPct !== null
			? `Computing ${config.runCount} projections — ${progressPct}%`
			: `Computing ${config.runCount} projections…`
		: stochasticResult
			? `Ready — ${config.runCount} run${config.runCount === 1 ? "" : "s"}${config.seed !== null ? ` (seed ${config.seed})` : ""}`
			: simulationActive
				? "Waiting to start…"
				: "Disabled";

	return (
		<Collapsible>
			<Collapsible.Trigger>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-start gap-3">
						<Collapsible.Chevron />
						<div>
							<div className="text-base font-semibold text-slate-900 dark:text-slate-100">
								Monte Carlo simulation
							</div>
							<div className="text-sm text-slate-500 dark:text-slate-400">
								{simulationActive
									? statusLabel
									: simulationRequested && !hasStochasticAccounts
										? "No scheduled transactions have volatility configured. Set volatility > 0 to enable simulation."
										: "Stochastic simulation is disabled. Toggle on to see probabilistic bands."}
							</div>
						</div>
					</div>
					<span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 transition-colors group-hover:text-slate-500 dark:text-slate-500 dark:group-hover:text-slate-300">
						Show details
					</span>
				</div>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div className="space-y-4">
					{/* Toggle row */}
					<div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
						<div>
							<div className="text-sm font-medium text-slate-900 dark:text-slate-100">
								Enable Monte Carlo simulation
							</div>
							<div className="text-xs text-slate-500 dark:text-slate-400">
								{hasStochasticAccounts
									? "Show probabilistic bands on the trend chart."
									: "Add volatility to a posting to use this feature."}
							</div>
						</div>
						<label className="relative inline-flex cursor-pointer items-center">
							<input
								type="checkbox"
								className="peer sr-only"
								checked={simulationActive}
								onChange={(e) =>
									onPreferenceChange(
										e.currentTarget.checked ? "enabled" : "disabled",
									)
								}
								disabled={!hasStochasticAccounts}
							/>
							<div className="peer h-6 w-11 rounded-full bg-slate-300 dark:bg-slate-600 after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white dark:after:bg-slate-200 after:transition-all peer-checked:bg-slate-900 dark:peer-checked:bg-slate-100 peer-checked:after:translate-x-full peer-disabled:opacity-40" />
						</label>
					</div>

					{simulationActive ? (
						<>
							<div className={"grid gap-3"}>
								<div className="space-y-1">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
										Run count
									</label>
									<input
										type="number"
										inputMode="numeric"
										min={1}
										max={10000}
										value={runCountInput}
										onChange={(e) => updateRunCountInput(e.currentTarget.value)}
										className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-slate-400"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
										Seed (optional)
									</label>
									<input
										type="number"
										inputMode="numeric"
										value={seedInput}
										onChange={(e) => updateSeedInput(e.currentTarget.value)}
										placeholder="Random"
										className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-slate-400"
									/>
								</div>
								<div className="flex items-end">
									<Button
										type="button"
										size="sm"
										onClick={applyImmediately}
										disabled={!hasPendingChanges && !isRunning}
										variant={hasPendingChanges ? "default" : "secondary"}
									>
										{hasPendingChanges
											? "Re-run now"
											: isRunning
												? "Running…"
												: "Re-run now"}
									</Button>
								</div>
							</div>
							{isRunning && progressPct !== null ? (
								<div className="space-y-1">
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
										<div
											className="h-full rounded-full bg-slate-900 transition-[width] duration-300 ease-out"
											style={{ width: `${progressPct}%` }}
										/>
									</div>
								</div>
							) : null}
							<div className="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
								<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
									How the simulation works
								</div>
								<ul className="mt-1.5 space-y-1 text-xs text-slate-600 dark:text-slate-400">
									<li>
										Each run samples a sequence of yearly investment returns for
										every volatile posting using a log-normal distribution.
									</li>
									<li>
										The expected return is the posting&apos;s annual rate; the
										volatility controls the spread of possible outcomes.
									</li>
									<li>
										Only postings with volatility &gt; 0 are randomized — all
										other values remain fixed across runs.
									</li>
									<li>
										Loan rates, salary, expenses, and tax rates are treated as
										deterministic unless separately modeled with volatility.
									</li>
									<li>
										Returns across different accounts and years are treated as
										independent — no correlation or market-crash scenarios are
										modeled.
									</li>
									<li>
										The simulation does not model inflation, mean reversion, or
										sequence-of-return risk beyond what volatility captures.
									</li>
								</ul>
							</div>
							)
							{stochasticResult ? (
								<div className="grid gap-3">
									<StochasticResultCard
										label="Modeled success rate"
										value={pct.format(
											stochasticResult.milestones.hitTargetProbability,
										)}
										detail="of simulated paths reached target"
									/>
									<StochasticResultCard
										label="Median simulated target date"
										value={
											stochasticResult.milestones.medianHitTargetDate
												? formatDate(
														stochasticResult.milestones.medianHitTargetDate,
													)
												: "Never"
										}
										detail="50th percentile across runs"
									/>
									<StochasticResultCard
										label="Conservative target date"
										value={
											stochasticResult.milestones.worstCaseHitTargetDate
												? formatDate(
														stochasticResult.milestones.worstCaseHitTargetDate,
													)
												: "Never"
										}
										detail="10th percentile (worst case)"
									/>
									<StochasticResultCard
										label="Median simulated final net worth"
										value={currency.format(
											stochasticResult.milestones.finalNetWorthPercentiles.p50,
										)}
										detail={`range ${currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p10)}–${currency.format(stochasticResult.milestones.finalNetWorthPercentiles.p90)}`}
									/>
								</div>
							) : null}
						</>
					) : null}
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
