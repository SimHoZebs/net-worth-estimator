import { Link } from "react-router-dom";
import { LabeledField } from "@/components/fields/field-kit";
import {
	StochasticProgressBar,
	StochasticProgressDetails,
} from "@/components/StochasticProgressDetails";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import {
	STOCHASTIC_DEBOUNCE_MS,
	useDebouncedStochasticConfig,
} from "@/hooks/useDebouncedStochasticConfig";
import {
	useProjectionCapabilities,
	useProjectionExecution,
	useStochasticProgress,
} from "@/runtime/projectionRuntime";
import { useStore } from "@/store";

export function StochasticControls() {
	const {
		isStochasticRunning: isRunning,
		stochasticError,
		retryStochastic,
	} = useProjectionExecution();
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
		pendingMs,
		runCountNotice,
		seedNotice,
		updateRunCountInput,
		updateSeedInput,
		applyImmediately,
	} = useDebouncedStochasticConfig(config, onConfigChange);

	// Indeterminate until the run phase reports a fraction (preparing and
	// deterministic-evaluation phases have no run counts yet).
	const runFraction =
		progress?.phase === "stochastic-runs" ? progress.fraction : null;
	const progressPct =
		typeof runFraction === "number" && Number.isFinite(runFraction)
			? Math.round(runFraction * 100)
			: null;
	const statusLabel = isRunning
		? progressPct !== null
			? `Computing ${config.runCount} projections — ${progressPct}%`
			: `Computing ${config.runCount} projections…`
		: stochasticError
			? "Monte Carlo failed — review the error below."
			: hasStochasticResult
				? `Ready — ${config.runCount} run${config.runCount === 1 ? "" : "s"}${config.seed !== null ? ` (seed ${config.seed})` : " (auto seed)"}`
				: simulationActive
					? "Waiting to start…"
					: stochasticPreference === "disabled"
						? "Disabled — Monte Carlo is off."
						: "Disabled — no postings have volatility configured.";

	return (
		<Collapsible defaultOpen={!hasStochasticResult || stochasticError !== null}>
			<Collapsible.Trigger>
				<Collapsible.Header
					title="Monte Carlo simulation"
					description={statusLabel}
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
					<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/75 px-4 py-3 dark:border-white/10 dark:bg-surface/55">
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

					{!hasStochasticAccounts ? (
						<p className="type-caption text-muted-foreground">
							No volatility configured.{" "}
							<Link
								to="/model-inputs"
								className="font-medium text-primary underline-offset-4 hover:underline"
							>
								Add volatility in Model inputs →
							</Link>
						</p>
					) : null}

					{stochasticError ? (
						<p
							role="alert"
							className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 type-caption text-destructive"
						>
							{stochasticError}{" "}
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="min-h-11 underline underline-offset-4"
								onClick={retryStochastic}
							>
								Retry simulation
							</Button>
						</p>
					) : null}

					{simulationActive ? (
						<>
							<div className="grid gap-3">
								<div>
									<LabeledField
										label="Independent sample count"
										id="stochastic-run-count"
										type="text"
										inputMode="numeric"
										value={runCountInput}
										onChange={updateRunCountInput}
										onBlur={applyImmediately}
										className="min-h-11 tabular-nums"
									/>
									{runCountNotice ? (
										<p role="status" className="mt-1 type-caption">
											{runCountNotice}
										</p>
									) : null}
								</div>
								<div>
									<LabeledField
										label="Seed (auto when blank)"
										id="stochastic-seed"
										type="text"
										inputMode="numeric"
										value={seedInput}
										onChange={updateSeedInput}
										onBlur={applyImmediately}
										placeholder="Auto"
										className="min-h-11 tabular-nums"
									/>
									{seedNotice ? (
										<p role="status" className="mt-1 type-caption">
											{seedNotice}
										</p>
									) : null}
								</div>
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-3">
										<Button
											type="button"
											size="sm"
											onClick={applyImmediately}
											disabled={!hasPendingChanges || isRunning}
											variant={
												hasPendingChanges && !isRunning
													? "default"
													: "secondary"
											}
											className="min-h-11"
										>
											{isRunning ? "Running…" : "Resample now"}
										</Button>
										{hasPendingChanges && !isRunning ? (
											<p
												role="status"
												className="flex items-center gap-2 type-caption text-muted-foreground"
											>
												<span
													aria-hidden="true"
													className="size-2 animate-pulse rounded-full bg-primary"
												/>
												Will resample in{" "}
												{Math.max(
													1,
													Math.ceil(
														(pendingMs ?? STOCHASTIC_DEBOUNCE_MS) / 1000,
													),
												)}
												s…
											</p>
										) : null}
									</div>
									{isRunning ? (
										<p className="type-caption text-muted-foreground">
											The run finishes on its own — edits above queue the next
											resample.
										</p>
									) : null}
								</div>
							</div>
							{isRunning && progress ? (
								<div className="space-y-1">
									<StochasticProgressBar
										fraction={runFraction}
										label="Monte Carlo progress"
									/>
									<StochasticProgressDetails progress={progress} compact />
								</div>
							) : null}
							<details className="rounded-xl border border-border/70 bg-surface/70 px-4 py-3 dark:border-white/10 dark:bg-surface/50">
								<summary className="cursor-pointer select-none type-eyebrow">
									How the simulation works
								</summary>
								<ul className="mt-1.5 space-y-1 type-caption">
									<li>
										With a blank seed, the seed is derived from the model
										inputs, so identical models produce identical bands and
										share cached results. Enter a seed to override it.
									</li>
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
							</details>
						</>
					) : null}
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
