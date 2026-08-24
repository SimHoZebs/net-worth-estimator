import { StochasticProgressDetails } from "@/components/StochasticProgressDetails";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { useDebouncedStochasticConfig } from "@/hooks/useDebouncedStochasticConfig";
import {
	useProjectionCapabilities,
	useProjectionExecution,
	useStochasticProgress,
} from "@/runtime/projectionRuntime";
import { useStore } from "@/store";

export function StochasticControls() {
	const { isStochasticRunning: isRunning } = useProjectionExecution();
	const progress = useStochasticProgress();
	const { hasStochasticAccounts, hasStochasticResult } =
		useProjectionCapabilities();
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

	const progressPct =
		progress !== null ? Math.round(progress.fraction * 100) : null;
	const statusLabel = isRunning
		? progressPct !== null
			? `Computing ${config.runCount} projections - ${progressPct}%`
			: `Computing ${config.runCount} projections…`
		: hasStochasticResult
			? `Ready — ${config.runCount} run${config.runCount === 1 ? "" : "s"}${config.seed !== null ? ` (seed ${config.seed})` : ""}`
			: simulationActive
				? "Waiting to start…"
				: "Disabled";

	return (
		<Collapsible>
			<Collapsible.Trigger>
				<Collapsible.Header
					title="Monte Carlo simulation"
					description={
						simulationActive
							? statusLabel
							: simulationRequested && !hasStochasticAccounts
								? "No scheduled transactions have volatility configured. Set volatility > 0 to enable simulation."
								: "Stochastic simulation is disabled. Toggle on to see probabilistic bands."
					}
					trailing={
						<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
							Show details
						</span>
					}
				/>
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
								aria-label="Enable Monte Carlo simulation"
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
									<label
										htmlFor="stochastic-run-count"
										className="type-eyebrow"
									>
										Independent sample count
									</label>
									<input
										id="stochastic-run-count"
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
									<label htmlFor="stochastic-seed" className="type-eyebrow">
										Seed (optional)
									</label>
									<input
										id="stochastic-seed"
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
											? "Resample now"
											: isRunning
												? "Running…"
												: "Resample now"}
									</Button>
								</div>
							</div>
							{isRunning && progressPct !== null ? (
								<div className="space-y-1">
									<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
										<div
											role="progressbar"
											aria-label="Monte Carlo progress"
											aria-valuemin={0}
											aria-valuemax={100}
											aria-valuenow={progressPct}
											className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
											style={{ width: `${progressPct}%` }}
										/>
									</div>
									{progress ? (
										<StochasticProgressDetails progress={progress} compact />
									) : null}
								</div>
							) : null}
							<div className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
								<div className="type-eyebrow">How the simulation works</div>
								<ul className="mt-1.5 space-y-1 type-caption">
									<li>
										Each independent Monte Carlo sample draws a sequence of
										yearly investment returns for every volatile posting using a
										log-normal distribution.
									</li>
									<li>
										The expected return is the posting&apos;s annual rate; the
										volatility controls the spread of possible outcomes.
									</li>
									<li>
										Only postings with volatility &gt; 0 are randomized — all
										other values remain fixed across independent samples.
									</li>
									<li>
										Loan rates, income sources, expenses, and tax profiles are
										treated as deterministic unless separately modeled with
										volatility.
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
						</>
					) : null}
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
