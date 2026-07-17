import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible-section";
import { currency, formatDate } from "@/lib/format";
import { type SnapshotMetrics, useStore } from "@/store";

interface ScenarioComparisonProps {
	currentMetrics: SnapshotMetrics;
	currentOverrideCount: number;
	canTakeSnapshot: boolean;
}

export function ScenarioComparison({
	currentMetrics,
	currentOverrideCount,
	canTakeSnapshot,
}: ScenarioComparisonProps) {
	const snapshots = useStore((s) => s.snapshots);
	const addSnapshotFromCurrentScenario = useStore(
		(s) => s.addSnapshotFromCurrentScenario,
	);
	const removeSnapshot = useStore((s) => s.removeSnapshot);
	const clearSnapshots = useStore((s) => s.clearSnapshots);
	const [labelInput, setLabelInput] = useState("");

	const hasSnapshots = snapshots.length > 0;

	return (
		<Collapsible defaultOpen={false}>
			<Collapsible.Trigger>
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-start gap-3">
						<Collapsible.Chevron />
						<div>
							<div className="type-title text-base">Scenario snapshots</div>
							<div className="type-muted">
								{hasSnapshots
									? `${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} saved. Save the current projection to compare with future changes.`
									: "Save the current projection to compare with future changes."}
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
							placeholder="Baseline (no overrides)"
							className="w-full rounded-lg border border-border/80 bg-card/85 px-3 py-1.5 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring dark:border-white/10 sm:max-w-xs"
						/>
						<Button
							type="button"
							size="sm"
							disabled={!labelInput.trim() || !canTakeSnapshot}
							onClick={() => {
								addSnapshotFromCurrentScenario(
									labelInput.trim(),
									currentMetrics,
								);
								setLabelInput("");
							}}
						>
							Take snapshot
						</Button>
						{hasSnapshots ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={clearSnapshots}
							>
								Clear all
							</Button>
						) : null}
					</div>

					{hasSnapshots ? (
						<div className="overflow-x-auto rounded-xl border border-border/80 dark:border-white/10">
							<table className="w-full min-w-[42rem] type-body">
								<thead>
									<tr className="border-b border-border/80 bg-muted/70 text-left type-label tracking-wide">
										<th className="px-4 py-3">Name</th>
										<th className="px-4 py-3">Current NW</th>
										<th className="px-4 py-3">Final NW</th>
										<th className="px-4 py-3">Deterministic FI date</th>
										<th className="px-4 py-3">Overrides</th>
										<th className="px-4 py-3" />
									</tr>
								</thead>
								<tbody>
									{snapshots.map((sn) => {
										const _sameCurrent =
											sn.metrics.currentNetWorth ===
											currentMetrics.currentNetWorth;
										const sameFinal =
											sn.metrics.finalNetWorth === currentMetrics.finalNetWorth;
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
													{sn.metrics.deterministicFiCycleDate
														? formatDate(sn.metrics.deterministicFiCycleDate)
														: "Beyond horizon"}
												</td>
												<td className="px-4 py-3 tabular-nums text-muted-foreground">
													{sn.metrics.overrideCount}
												</td>
												<td className="px-4 py-3 text-right">
													<div className="flex justify-end gap-2">
														<button
															type="button"
															onClick={() => removeSnapshot(sn.id)}
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
											{currentMetrics.deterministicFiCycleDate
												? formatDate(currentMetrics.deterministicFiCycleDate)
												: "Beyond horizon"}
										</td>
										<td className="px-4 py-3 tabular-nums type-value font-semibold">
											{currentOverrideCount}
										</td>
										<td />
									</tr>
								</tbody>
							</table>
							<div className="border-t border-border/70 bg-muted/70 px-4 py-2 type-caption text-muted-foreground/70">
								Snapshots store what-if configuration. To restore, manually
								apply the override counts shown above.
							</div>
						</div>
					) : null}
				</div>
			</Collapsible.Content>
		</Collapsible>
	);
}
