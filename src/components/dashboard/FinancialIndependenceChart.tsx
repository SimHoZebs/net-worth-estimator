import { memo, useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { currency, formatDate } from "@/lib/format";
import type { FinancialIndependenceAnalysis } from "@/lib/projection";

export const FinancialIndependenceChart = memo(
	function FinancialIndependenceChart({
		analysis,
	}: {
		analysis: FinancialIndependenceAnalysis;
	}) {
		const titleId = useId();
		const step = Math.max(1, Math.ceil(analysis.rows.length / 80));
		const rows = analysis.rows.filter(
			(_, index) => index % step === 0 || index === analysis.rows.length - 1,
		);
		const maxValue = Math.max(
			1,
			...rows.flatMap((row) => [
				row.totalAnnualCapacity,
				row.annualExpenseTarget,
			]),
		);
		const firstTime = Date.parse(`${rows[0]?.date ?? "1970-01-01"}T00:00:00Z`);
		const lastTime = Date.parse(
			`${rows[rows.length - 1]?.date ?? "1970-01-01"}T00:00:00Z`,
		);
		const timeRange = Math.max(1, lastTime - firstTime);
		const point = (value: number, date: string) => {
			const time = Date.parse(`${date}T00:00:00Z`);
			const x = ((time - firstTime) / timeRange) * 760;
			const y = 170 - (value / maxValue) * 150;
			return `${x + 20},${y}`;
		};
		const capacityPoints = rows
			.map((row) => point(row.totalAnnualCapacity, row.date))
			.join(" ");
		const expensePoints = rows
			.map((row) => point(row.annualExpenseTarget, row.date))
			.join(" ");

		return (
			<Card className="overflow-hidden rounded-[1.8rem] border-border/80">
				<CardHeader className="flex-col items-start gap-3 sm:flex-row sm:justify-between">
					<div>
						<CardTitle id={titleId}>FI capacity corridor</CardTitle>
						<p className="mt-1 type-muted">
							Selected annual income and withdrawals versus growing expenses.
						</p>
					</div>
					<div className="flex shrink-0 flex-col gap-1 type-caption sm:flex-row sm:gap-4">
						<span className="flex items-center gap-1.5">
							<i className="h-0.5 w-4 bg-primary" />
							Capacity
						</span>
						<span className="flex items-center gap-1.5">
							<i className="h-0.5 w-4 bg-tertiary" />
							Expenses
						</span>
					</div>
				</CardHeader>
				<CardContent>
					{rows.length === 0 ? (
						<div className="rounded-2xl border border-dashed border-border p-8 text-center type-muted">
							No projected FI dates are available.
						</div>
					) : (
						<>
							<svg
								viewBox="0 0 800 190"
								role="img"
								aria-labelledby={titleId}
								className="h-auto min-h-40 w-full overflow-visible"
							>
								<defs>
									<linearGradient
										id="fi-capacity-fill"
										x1="0"
										y1="0"
										x2="0"
										y2="1"
									>
										<stop
											offset="0"
											stopColor="var(--color-primary)"
											stopOpacity="0.18"
										/>
										<stop
											offset="1"
											stopColor="var(--color-primary)"
											stopOpacity="0"
										/>
									</linearGradient>
								</defs>
								<line
									x1="20"
									y1="170"
									x2="780"
									y2="170"
									stroke="currentColor"
									opacity="0.16"
								/>
								<polygon
									points={`20,170 ${capacityPoints} 780,170`}
									fill="url(#fi-capacity-fill)"
								/>
								<polyline
									points={expensePoints}
									fill="none"
									stroke="var(--color-tertiary)"
									strokeWidth="3"
									strokeDasharray="7 6"
								/>
								<polyline
									points={capacityPoints}
									fill="none"
									stroke="var(--color-primary)"
									strokeWidth="4"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<div className="mt-2 grid grid-cols-2 gap-2 type-caption text-muted-foreground">
								<span>{formatDate(rows[0].date)}</span>
								<span className="text-right">
									{formatDate(rows[rows.length - 1].date)}
								</span>
								<span className="col-span-2 text-center">
									Peak scale {currency.format(maxValue)}/yr
								</span>
							</div>
						</>
					)}
				</CardContent>
			</Card>
		);
	},
);
