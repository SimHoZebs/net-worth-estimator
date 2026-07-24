import { useState } from "react";
import { formatFrequency } from "@/lib/format";
import type { FinancialModelDocument } from "@/lib/projection";
import { useStore } from "@/store";

export function AssumptionList({
	document,
}: {
	document: FinancialModelDocument;
}) {
	const [showFormulas, setShowFormulas] = useState(false);
	const disabledPostingIds = useStore((s) => s.disabledPostingIds);
	const togglePostingDisabled = useStore((s) => s.togglePostingDisabled);
	const disabledSet = new Set(disabledPostingIds);
	const incomePostings = document.postings.filter((p) => !p.sourceAccountId);
	const expensePostings = document.postings.filter((p) => p.sourceAccountId);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div className="type-muted">
					Showing{" "}
					{showFormulas ? "raw formulas" : "plain-language descriptions"}
				</div>
				<button
					type="button"
					onClick={() => setShowFormulas(!showFormulas)}
					className="rounded-lg border border-border px-3 py-1 type-label transition hover:border-ring hover:text-foreground"
				>
					{showFormulas ? "Hide formulas" : "Show formulas"}
				</button>
			</div>
			<div className="grid gap-6 md:grid-cols-2">
				<div>
					<h4 className="mb-2 type-eyebrow">Income</h4>
					<div className="space-y-1">
						{incomePostings.length > 0 ? (
							incomePostings.map((p) => {
								const isDisabled = disabledSet.has(p.id);
								return (
									<div
										key={p.id}
										className={`flex items-center justify-between rounded-lg px-2 py-1 type-body transition ${isDisabled ? "opacity-40" : "hover:bg-muted"}`}
									>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => togglePostingDisabled(p.id)}
												className={`flex h-4 w-4 items-center justify-center rounded border transition ${
													isDisabled
														? "border-border bg-card"
														: "border-primary bg-primary "
												}`}
												title={
													isDisabled
														? "Enable this posting"
														: "Disable this posting temporarily"
												}
											>
												{isDisabled ? null : (
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="none"
														stroke="white"
														strokeWidth="3"
														strokeLinecap="round"
														strokeLinejoin="round"
													>
														<polyline points="20 6 9 17 4 12" />
													</svg>
												)}
											</button>
											<span
												className={`text-foreground/80 ${isDisabled ? "line-through" : ""}`}
											>
												{p.label}
											</span>
										</div>
										<span className="type-value">
											{showFormulas
												? `${p.arithmetic} (${formatFrequency(p.frequency)})`
												: `${formatFrequency(p.frequency)} inflow${isDisabled ? "" : ""}`}
										</span>
									</div>
								);
							})
						) : (
							<div className="type-muted text-muted-foreground/70">
								No external income scheduled.
							</div>
						)}
					</div>
				</div>
				<div>
					<h4 className="mb-2 type-eyebrow">Expenses & transfers</h4>
					<div className="space-y-1">
						{expensePostings.length > 0 ? (
							expensePostings.map((p) => {
								const isDisabled = disabledSet.has(p.id);
								return (
									<div
										key={p.id}
										className={`flex items-center justify-between rounded-lg px-2 py-1 type-body transition ${isDisabled ? "opacity-40" : "hover:bg-muted"}`}
									>
										<div className="flex items-center gap-2">
											<button
												type="button"
												onClick={() => togglePostingDisabled(p.id)}
												className={`flex h-4 w-4 items-center justify-center rounded border transition ${
													isDisabled
														? "border-border bg-card"
														: "border-primary bg-primary"
												}`}
												title={
													isDisabled
														? "Enable this posting"
														: "Disable this posting temporarily"
												}
											>
												{isDisabled ? null : (
													<svg
														xmlns="http://www.w3.org/2000/svg"
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="none"
														stroke="white"
														strokeWidth="3"
														strokeLinecap="round"
														strokeLinejoin="round"
													>
														<polyline points="20 6 9 17 4 12" />
													</svg>
												)}
											</button>
											<span
												className={`text-foreground/80 ${isDisabled ? "line-through" : ""}`}
											>
												{p.label}
											</span>
										</div>
										<span className="type-value">
											{showFormulas
												? `${p.arithmetic} (${formatFrequency(p.frequency)})`
												: `${formatFrequency(p.frequency)} outflow`}
										</span>
									</div>
								);
							})
						) : (
							<div className="type-muted text-muted-foreground/70">
								No outgoing transactions scheduled.
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
