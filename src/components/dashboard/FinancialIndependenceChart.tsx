import { memo, useCallback, useMemo } from "react";
import type uPlot from "uplot";
import { parseChartDate } from "@/chart/chartData";
import { createBaseOptions } from "@/chart/uplotBase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { currency, formatDate } from "@/lib/format";
import type {
	FinancialIndependenceDetailedRunOutcome,
	FinancialModelDocument,
} from "@/lib/projection";
import { escapeHtml } from "@/lib/utils";

const FALLBACK_ACCOUNT_COLOR = "GrayText";

interface FinancialIndependenceChartProps {
	document: FinancialModelDocument;
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
		outcome,
	}: FinancialIndependenceChartProps) {
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
		const balanceIndex = useMemo(
			() => buildFinancialIndependenceBalanceIndex(outcome),
			[outcome],
		);
		const data = useMemo(
			() =>
				buildFinancialIndependenceBalanceData(
					outcome,
					accountIds,
					balanceIndex,
				),
			[outcome, accountIds, balanceIndex],
		);
		const options = useMemo(
			() => buildFinancialIndependenceChartOptions(accounts),
			[accounts],
		);
		const tooltipContent = useCallback(
			(_chart: uPlot, index: number) =>
				buildFinancialIndependenceBalanceTooltip(
					outcome,
					accounts,
					balanceIndex,
					index,
				),
			[outcome, accounts, balanceIndex],
		);

		return (
			<Card className="overflow-hidden rounded-[1.8rem] border-border/80">
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<CardTitle>Opening and month-end balances</CardTitle>
						{outcome.status === "ineligible" ? (
							<span className="rounded-full border border-tertiary-border bg-tertiary-subtle px-3 py-1 type-label uppercase tracking-[0.12em] text-tertiary-foreground">
								Counterfactual preview
							</span>
						) : null}
					</div>
				</CardHeader>
				<CardContent>
					{outcome.balanceTrajectory.length > 0 && accounts.length > 0 ? (
						<>
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

export type FinancialIndependenceBalanceIndex = ReadonlyArray<
	ReadonlyMap<string, number>
>;

export function buildFinancialIndependenceBalanceIndex(
	outcome: FinancialIndependenceDetailedRunOutcome,
): FinancialIndependenceBalanceIndex {
	return outcome.balanceTrajectory.map((row) => {
		const balanceByAccountId = new Map<string, number>();
		for (const account of row.accounts) {
			if (!balanceByAccountId.has(account.accountId)) {
				balanceByAccountId.set(account.accountId, account.balance);
			}
		}
		return balanceByAccountId;
	});
}

export function buildFinancialIndependenceBalanceData(
	outcome: FinancialIndependenceDetailedRunOutcome,
	accountIds: readonly string[],
	balanceIndex: FinancialIndependenceBalanceIndex,
): uPlot.AlignedData {
	if (outcome.balanceTrajectory.length === 0) {
		return Array.from({ length: accountIds.length + 1 }, () => [
			0,
		]) as uPlot.AlignedData;
	}
	return [
		outcome.balanceTrajectory.map((row) => parseChartDate(row.date)),
		...accountIds.map((accountId) =>
			balanceIndex.map(
				(balanceByAccountId) => balanceByAccountId.get(accountId) ?? 0,
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
	balanceIndex: FinancialIndependenceBalanceIndex,
	index: number,
) {
	const row = outcome.balanceTrajectory[index];
	if (!row) return "";
	const balanceByAccountId = balanceIndex[index];
	const balances = accounts.map((account) => ({
		...account,
		balance: balanceByAccountId?.get(account.id) ?? 0,
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
