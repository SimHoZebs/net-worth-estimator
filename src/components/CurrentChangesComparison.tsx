import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { currency } from "@/lib/format";
import {
	useProjectionArtifacts,
	useProjectionCapabilities,
} from "@/runtime/projectionRuntime";
import {
	type ComparisonMetrics,
	selectCurrentChangeCount,
	useStore,
} from "@/store";

export const CurrentChangesComparison = memo(
	function CurrentChangesComparison() {
		const { currentMetrics } = useProjectionArtifacts();
		const { canCaptureComparison } = useProjectionCapabilities();
		const currentChangeCount = useStore(selectCurrentChangeCount);
		const comparisonSnapshots = useStore((s) => s.comparisonSnapshots);
		const captureCurrentComparison = useStore(
			(s) => s.captureCurrentComparison,
		);
		const removeComparison = useStore((s) => s.removeComparison);
		const clearComparisons = useStore((s) => s.clearComparisons);
		const [labelInput, setLabelInput] = useState("");

		const hasComparisons = comparisonSnapshots.length > 0;

		return (
			<Collapsible defaultOpen={false}>
				<Collapsible.Trigger>
					<div className="flex items-start justify-between gap-4">
						<div className="flex items-start gap-3">
							<Collapsible.Chevron />
							<div>
								<div className="type-title text-base">Saved comparisons</div>
								<div className="type-muted">
									{hasComparisons
										? `${comparisonSnapshots.length} comparison snapshot${comparisonSnapshots.length === 1 ? "" : "s"} saved. Capture the current projection to compare with future changes.`
										: "Capture the current projection to compare with future changes."}
								</div>
							</div>
						</div>
						<span className="hidden type-label uppercase tracking-[0.16em] transition-colors group-hover:text-foreground/70 sm:inline">
							Show details
						</span>
					</div>
				</Collapsible.Trigger>
				<Collapsible.Content>
					<div className="space-y-4">
						<div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
							<input
								type="text"
								value={labelInput}
								onChange={(e) => setLabelInput(e.target.value)}
								placeholder="Baseline (no temporary changes)"
								className="w-full rounded-lg border border-border/80 bg-card/85 px-3 py-1.5 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring dark:border-white/10 sm:max-w-xs"
							/>
							<Button
								type="button"
								size="sm"
								disabled={!labelInput.trim() || !canCaptureComparison}
								onClick={() => {
									captureCurrentComparison(labelInput.trim(), currentMetrics);
									setLabelInput("");
								}}
							>
								Save comparison
							</Button>
							{hasComparisons ? (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={clearComparisons}
								>
									Clear all
								</Button>
							) : null}
						</div>

						{hasComparisons ? (
							<div className="overflow-x-auto rounded-xl border border-border/80 dark:border-white/10">
								<table className="w-full min-w-[42rem] type-body">
									<thead>
										<tr className="border-b border-border/80 bg-muted/70 text-left type-label tracking-wide">
											<th className="px-4 py-3">Name</th>
											<th className="px-4 py-3">Current NW</th>
											<th className="px-4 py-3">Final NW</th>
											<th className="px-4 py-3">Evaluation outcomes</th>
											<th className="px-4 py-3">Temporary changes</th>
											<th className="px-4 py-3" />
										</tr>
									</thead>
									<tbody>
										{comparisonSnapshots.map((sn) => {
											const sameFinal =
												sn.metrics.finalNetWorth ===
												currentMetrics.finalNetWorth;
											return (
												<tr
													key={sn.id}
													className="border-b border-border/70 last:border-b-0"
												>
													<td className="px-4 py-3 type-value">{sn.label}</td>
													<td className="px-4 py-3 tabular-nums text-foreground">
														{currency.format(sn.metrics.currentNetWorth)}
													</td>
													<td
														className={`px-4 py-3 tabular-nums ${sameFinal ? "text-muted-foreground/70" : "text-foreground"}`}
													>
														{currency.format(sn.metrics.finalNetWorth)}
													</td>
													<td className="px-4 py-3 text-foreground">
														<EvaluationOutcomes
															outcomes={sn.metrics.evaluationOutcomes}
														/>
													</td>
													<td className="px-4 py-3 tabular-nums text-muted-foreground">
														{sn.metrics.currentChangeCount}
													</td>
													<td className="px-4 py-3 text-right">
														<div className="flex justify-end gap-2">
															<button
																type="button"
																onClick={() => removeComparison(sn.id)}
																className="type-caption text-muted-foreground/70 hover:text-destructive"
															>
																Remove
															</button>
														</div>
													</td>
												</tr>
											);
										})}
										<tr className="border-t-2 border-border bg-muted/70">
											<td className="px-4 py-3 type-value font-semibold">
												Current
											</td>
											<td className="px-4 py-3 tabular-nums type-value font-semibold">
												{currency.format(currentMetrics.currentNetWorth)}
											</td>
											<td className="px-4 py-3 tabular-nums type-value font-semibold">
												{currency.format(currentMetrics.finalNetWorth)}
											</td>
											<td className="px-4 py-3 type-value font-semibold">
												<EvaluationOutcomes
													outcomes={currentMetrics.evaluationOutcomes}
												/>
											</td>
											<td className="px-4 py-3 tabular-nums type-value font-semibold">
												{currentChangeCount}
											</td>
											<td />
										</tr>
									</tbody>
								</table>
								<div className="border-t border-border/70 bg-muted/70 px-4 py-2 type-caption text-muted-foreground/70">
									Comparison snapshots are read-only captures of projection
									outcomes. They do not save or restore alternative models.
								</div>
							</div>
						) : null}
					</div>
				</Collapsible.Content>
			</Collapsible>
		);
	},
);

function EvaluationOutcomes({
	outcomes,
}: {
	outcomes: ComparisonMetrics["evaluationOutcomes"];
}) {
	return outcomes.length > 0 ? (
		<div className="flex min-w-48 flex-col gap-1.5">
			{outcomes.map((outcome) => (
				<div
					key={outcome.instanceId}
					className="flex items-center justify-between gap-3 type-caption"
				>
					<span className="truncate">{outcome.label}</span>
					<span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 uppercase tracking-[0.1em]">
						{outcome.status}
					</span>
				</div>
			))}
		</div>
	) : (
		<span className="type-caption text-muted-foreground">No evaluations</span>
	);
}
