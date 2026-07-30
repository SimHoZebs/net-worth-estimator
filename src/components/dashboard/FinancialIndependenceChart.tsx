import { memo, useCallback, useMemo } from "react";
import type uPlot from "uplot";
import { parseChartDate } from "@/chart/chartData";
import { createBaseOptions } from "@/chart/uplotBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { currency, formatDate, pct } from "@/lib/format";
import type {
	FinancialIndependenceDetailedRunOutcome,
	FinancialIndependenceRow,
	FinancialModelDocument,
} from "@/lib/projection";
import { escapeHtml } from "@/lib/utils";

const FALLBACK_ACCOUNT_COLOR = "GrayText";

interface FinancialIndependenceChartProps {
	document: FinancialModelDocument;
	row: FinancialIndependenceRow;
	outcome: FinancialIndependenceDetailedRunOutcome;
}

export interface FinancialIndependenceChartAccount {
	id: string;
	label: string;
	color: string;
}

export const FinancialIndependenceChart = memo(
	function FinancialIndependenceChart({
		document,
		row,
		outcome,
	}: FinancialIndependenceChartProps) {
		const capacityGap = buildFinancialIndependenceCapacityGap(row);
		const accountIds = useMemo(
			() =>
				outcome.balanceTrajectory[0]?.accounts.map(
					(account) => account.accountId,
				) ?? [],
			[outcome.balanceTrajectory],
		);
		const accountsById = useMemo(
			() => new Map(document.accounts.map((account) => [account.id, account])),
			[document.accounts],
		);
		const accounts = useMemo(
			() =>
				accountIds.map((accountId) => ({
					id: accountId,
					label: accountsById.get(accountId)?.label ?? accountId,
					color: accountsById.get(accountId)?.color ?? FALLBACK_ACCOUNT_COLOR,
				})),
			[accountIds, accountsById],
		);
		const data = useMemo(
			() => buildFinancialIndependenceBalanceData(outcome, accountIds),
			[outcome, accountIds],
		);
		const options = useMemo(
			() => buildFinancialIndependenceChartOptions(accounts),
			[accounts],
		);
		const tooltipContent = useCallback(
			(_chart: uPlot, index: number) =>
				buildFinancialIndependenceBalanceTooltip(outcome, accounts, index),
			[outcome, accounts],
		);

		return (
			<Card className="overflow-hidden rounded-[1.8rem] border-border/80">
				<CardHeader>
					<CardTitle>FI funding gap and account balances</CardTitle>
					<p className="type-muted">
						The bar is the initial annual funding-capacity gate. Account lines
						show simulated monthly balances during the FI test.
					</p>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="rounded-2xl border border-primary-border/50 bg-primary-subtle/35 p-4">
						<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
							<div>
								<div className="type-label">
									Initial annual funding capacity
								</div>
								<div className="mt-1 type-value text-foreground">
									{currency.format(row.totalAnnualCapacity)} / year available
								</div>
							</div>
							<div className="text-left type-muted sm:text-right">
								{row.annualExpenseTarget > 0
									? `${currency.format(row.annualExpenseTarget)} / year needed`
									: "No annual spending target configured"}
							</div>
						</div>
						{row.annualExpenseTarget > 0 ? (
							<>
								<div className="relative mt-3 h-3 overflow-hidden rounded-full bg-border/70">
									<div
										className="h-full rounded-full bg-primary transition-[width] duration-300"
										style={{ width: `${capacityGap.fillPercent}%` }}
									/>
									<div className="absolute inset-y-0 right-0 w-0.5 bg-foreground/70" />
								</div>
								<div className="mt-2 flex flex-wrap justify-between gap-2 type-caption">
									<span>{pct.format(row.coverageRatio)} of initial target</span>
									<strong className="type-value">
										{capacityGap.difference < 0
											? `${currency.format(Math.abs(capacityGap.difference))} / year below target`
											: capacityGap.difference > 0
												? `${currency.format(capacityGap.difference)} / year above target`
												: "Initial target met exactly"}
									</strong>
								</div>
							</>
						) : (
							<p className="mt-2 type-caption">
								Set an annual spending target to evaluate the initial capacity
								gap.
							</p>
						)}
					</div>

					{outcome.balanceTrajectory.length > 0 && accounts.length > 0 ? (
						<>
							<div>
								<div className="type-label">Selected account balances</div>
								<p className="type-caption">
									{outcome.status === "ineligible"
										? "Counterfactual diagnostic cycle; it does not establish financial independence."
										: "Hover a monthly point for exact post-withdrawal values."}
								</p>
							</div>
							<UPlotChart
								options={options}
								data={data}
								tooltipContent={tooltipContent}
							/>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 type-caption">
								{accounts.map((account) => (
									<span
										key={account.id}
										className="inline-flex items-center gap-1.5"
									>
										<span
											className="inline-block h-2.5 w-2.5 rounded-full"
											style={{ backgroundColor: account.color }}
										/>
										{account.label}
									</span>
								))}
							</div>
						</>
					) : (
						<p className="type-muted">
							No selected accounts are included in this FI plan.
						</p>
					)}
				</CardContent>
			</Card>
		);
	},
);

export function buildFinancialIndependenceCapacityGap(
	row: FinancialIndependenceRow,
) {
	if (row.annualExpenseTarget <= 0) {
		return { fillPercent: 0, difference: 0 };
	}
	return {
		fillPercent: Math.min(
			100,
			Math.max(0, (row.totalAnnualCapacity / row.annualExpenseTarget) * 100),
		),
		difference: row.totalAnnualCapacity - row.annualExpenseTarget,
	};
}

export function buildFinancialIndependenceBalanceData(
	outcome: FinancialIndependenceDetailedRunOutcome,
	accountIds: readonly string[],
): uPlot.AlignedData {
	if (outcome.balanceTrajectory.length === 0) {
		return Array.from({ length: accountIds.length + 1 }, () => [
			0,
		]) as uPlot.AlignedData;
	}
	return [
		outcome.balanceTrajectory.map((row) => parseChartDate(row.date)),
		...accountIds.map((accountId) =>
			outcome.balanceTrajectory.map(
				(row) =>
					row.accounts.find((account) => account.accountId === accountId)
						?.balance ?? 0,
			),
		),
	];
}

export function buildFinancialIndependenceChartOptions(
	accounts: readonly FinancialIndependenceChartAccount[],
): uPlot.Options {
	const base = createBaseOptions();
	return {
		...base,
		width: 0,
		height: 0,
		legend: { show: false },
		series: [
			{},
			...accounts.map((account) => ({
				label: account.label,
				show: true,
				stroke: account.color,
				width: 2.5,
				points: {
					show: true,
					size: 6,
					width: 2,
					stroke: account.color,
					fill: "Canvas",
				},
			})),
		],
		bands: [],
		scales: {
			...base.scales,
			y: {
				range: (_chart: uPlot, min: number, max: number) => {
					const padding = Math.max(
						1,
						(max - min) * 0.1,
						Math.max(Math.abs(min), Math.abs(max)) * 0.02,
					);
					return [min - padding, max + padding];
				},
			},
		},
	};
}

export function buildFinancialIndependenceBalanceTooltip(
	outcome: FinancialIndependenceDetailedRunOutcome,
	accounts: readonly FinancialIndependenceChartAccount[],
	index: number,
) {
	const row = outcome.balanceTrajectory[index];
	if (!row) return "";
	const balances = accounts.map((account) => ({
		...account,
		balance:
			row.accounts.find((entry) => entry.accountId === account.id)?.balance ??
			0,
	}));
	const total = balances.reduce((sum, account) => sum + account.balance, 0);
	let html =
		'<div class="min-w-56 rounded-lg border border-border/80 bg-card/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/10">';
	html += `<div class="type-label">${escapeHtml(formatDate(row.date))}</div>`;
	html += '<div class="mt-1 space-y-1">';
	for (const account of balances) {
		html += '<div class="flex justify-between gap-4 type-caption">';
		html +=
			'<span class="inline-flex min-w-0 items-center gap-1.5 text-foreground/80">';
		html +=
			'<span class="inline-block h-2 w-2 shrink-0 rounded-full bg-muted-foreground"></span>';
		html += `<span class="truncate">${escapeHtml(account.label)}</span></span>`;
		html += `<span class="tabular-nums text-foreground/80">${escapeHtml(currency.format(account.balance))}</span>`;
		html += "</div>";
	}
	html +=
		'<div class="mt-1 flex justify-between gap-4 border-t border-border/70 pt-1 type-caption type-value">';
	html += "<span>Selected assets</span>";
	html += `<span class="tabular-nums">${escapeHtml(currency.format(total))}</span>`;
	html += "</div></div></div>";
	return html;
}
