import { memo, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { ScenarioPack } from "@/lib/projection";
import { AccountLinesChart } from "./AccountLinesChart";
import { StackedContributionChart } from "./StackedContributionChart";

interface AccountDiagnosticChartProps {
	pack: ScenarioPack;
	targetNetWorth: number;
	hasStochasticData: boolean;
	chartData: Record<string, string | number>[];
	milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const AccountDiagnosticChart = memo(function AccountDiagnosticChart({
	pack,
	targetNetWorth,
	hasStochasticData,
	chartData,
	milestoneDates,
}: AccountDiagnosticChartProps) {
	const [viewMode, setViewMode] = useState<"stacked" | "accounts">("stacked");

	return (
		<section>
			<Card className="min-w-0 rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
				<CardHeader>
					<div className="flex items-start justify-between gap-4">
						<div>
							<CardTitle>Net worth projection</CardTitle>
							<CardDescription>
								{viewMode === "stacked"
									? "Net worth over time with account contributions."
									: "Individual account balances over time."}
							</CardDescription>
						</div>
						<button
							type="button"
							onClick={() =>
								setViewMode(viewMode === "stacked" ? "accounts" : "stacked")
							}
							className="shrink-0 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition hover:border-slate-300 dark:hover:border-slate-600 hover:text-slate-800 dark:hover:text-slate-200 no-print"
						>
							{viewMode === "stacked"
								? "Show account lines"
								: "Show stacked contributions"}
						</button>
					</div>
				</CardHeader>
				<CardContent className="min-w-0">
					{viewMode === "stacked" ? (
						<StackedContributionChart
							pack={pack}
							targetNetWorth={targetNetWorth}
							hasStochasticData={hasStochasticData}
							chartData={chartData}
							milestoneDates={milestoneDates}
						/>
					) : (
						<AccountLinesChart pack={pack} chartData={chartData} />
					)}
				</CardContent>
			</Card>
		</section>
	);
});
