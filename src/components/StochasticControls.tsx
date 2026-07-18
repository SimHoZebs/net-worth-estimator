import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { useDebouncedStochasticConfig } from "@/hooks/useDebouncedStochasticConfig";
import { currency, formatDate, pct } from "@/lib/format";
import {
	getFinancialIndependenceResult,
	type StochasticProjectionResult,
} from "@/lib/projection";
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
	const isProvisional = isRunning && stochasticResult !== null;
	const financialIndependence =
		getFinancialIndependenceResult(stochasticResult)?.probabilistic ?? null;

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
							<div className="type-title text-base">Monte Carlo simulation</div>
							<div className="type-muted">
								{simulationActive
									? statusLabel
									: simulationRequested && !hasStochasticAccounts
										? "No scheduled transactions have volatility configured. Set volatility > 0 to enable simulation."
										: "Stochastic simulation is disabled. Toggle on to see probabilistic bands."}
							</div>
						</div>
					</div>
					<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
						Show details
					</span>
				</div>
			</Collapsible.Trigger>
			<Collapsible.Content>
				<div className="space-y-4">
					{/* Toggle row */}
					<div className="flex items-center justify-between rounded-xl border border-border/80 bg-surface/75 px-4 py-3 dark:border-white/10 dark:bg-surface/55">
						<div>
							<div className="type-value text-sm">
								Enable Monte Carlo simulation
							</div>
							<div className="type-caption">
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
							<div className="peer h-6 w-11 rounded-full bg-muted-foreground/35 shadow-inner after:absolute after:left-[2px] after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-card after:shadow-sm after:transition-all peer-checked:bg-primary peer-checked:after:translate-x-full peer-disabled:opacity-40" />
						</label>
					</div>

					{simulationActive ? (
						<>
							<div className={"grid gap-3"}>
								<div className="space-y-1">
									<label className="type-eyebrow">Run count</label>
									<input
										type="number"
										inputMode="numeric"
										min={1}
										max={10000}
										value={runCountInput}
										onChange={(e) => updateRunCountInput(e.currentTarget.value)}
										className="w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 type-body shadow-sm outline-none focus:border-ring dark:border-white/10"
									/>
								</div>
								<div className="space-y-1">
									<label className="type-eyebrow">Seed (optional)</label>
									<input
										type="number"
										inputMode="numeric"
										value={seedInput}
										onChange={(e) => updateSeedInput(e.currentTarget.value)}
										placeholder="Random"
										className="w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring dark:border-white/10"
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
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
											style={{ width: `${progressPct}%` }}
										/>
									</div>
								</div>
							) : null}
							<div className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
								<div className="type-eyebrow">How the simulation works</div>
								<ul className="mt-1.5 space-y-1 type-caption">
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
							{stochasticResult ? (
								<div className="grid gap-3">
									{isProvisional ? (
										<p className="rounded-xl border border-primary-border bg-primary-subtle px-3 py-2 type-caption text-primary">
											Provisional results from completed runs. Values may change
											until all runs finish.
										</p>
									) : null}
									{financialIndependence ? (
										<>
											<StochasticResultCard
												label={`${isProvisional ? "Provisional " : ""}FI-cycle success probability`}
												value={pct.format(
													financialIndependence.fiCycleSuccessProbability,
												)}
												detail="complete runs funded expenses and met principal policy"
											/>
											<StochasticResultCard
												label={`${isProvisional ? "Provisional " : ""}Median coverage date`}
												value={
													financialIndependence.medianCoverageDate
														? formatDate(
																financialIndependence.medianCoverageDate,
															)
														: "Never"
												}
												detail="median annual capacity first covers expenses"
											/>
											<StochasticResultCard
												label={`${isProvisional ? "Provisional " : ""}Confidence-qualified FI date`}
												value={
													financialIndependence.selfSustainingDate
														? formatDate(
																financialIndependence.selfSustainingDate,
															)
														: "Never"
												}
												detail="first candidate meeting required confidence"
											/>
										</>
									) : null}
									<StochasticResultCard
										label={`${isProvisional ? "Provisional " : ""}Median simulated final net worth`}
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
