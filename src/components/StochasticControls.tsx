import { Link } from "react-router-dom";
import { LabeledField } from "@/components/fields/FieldKit";
import {
	StochasticProgressBar,
	StochasticProgressDetails,
} from "@/components/StochasticProgressDetails";
import { Button } from "@/components/ui/Button";
import { Collapsible } from "@/components/ui/CollapsibleSection";
import { useDebouncedStochasticConfig } from "@/hooks/useDebouncedStochasticConfig";
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
			? `${progressPct}%`
			: "…"
		: stochasticError
			? "Failed."
			: hasStochasticResult
				? `${config.runCount}${config.seed !== null ? ` · ${config.seed}` : ""}`
				: simulationActive
					? "…"
					: "Off";

	const body = (
		<div className="space-y-4">
			<div className="flex items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface/75 px-4 py-3 dark:border-white/10 dark:bg-surface/55">
				<div className="type-value text-sm">Monte Carlo</div>
				<label className="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						aria-label="Monte Carlo"
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
					<Link
						to="/accounts"
						className="font-medium text-primary underline-offset-4 hover:underline"
					>
						Add volatility →
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
						Retry
					</Button>
				</p>
			) : null}

			{simulationActive ? (
				<>
					<div className="grid gap-3">
						<div>
							<LabeledField
								label="Samples"
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
								label="Seed"
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
						<div className="flex items-center gap-3">
							<Button
								type="button"
								size="sm"
								onClick={applyImmediately}
								disabled={!hasPendingChanges || isRunning}
								variant={
									hasPendingChanges && !isRunning ? "default" : "secondary"
								}
								className="min-h-11"
							>
								{isRunning ? "Running…" : "Resample"}
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
									…
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
				</>
			) : null}
		</div>
	);

	return (
		<Collapsible defaultOpen={!hasStochasticResult || stochasticError !== null}>
			<Collapsible.Trigger>
				<Collapsible.Header
					title="Monte Carlo"
					description={statusLabel}
					trailing={
						<span className="type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70">
							›
						</span>
					}
				/>
			</Collapsible.Trigger>
			<Collapsible.Content>{body}</Collapsible.Content>
		</Collapsible>
	);
}
