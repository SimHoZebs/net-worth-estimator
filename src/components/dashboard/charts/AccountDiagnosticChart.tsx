import { memo, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { FinancialModelDocument } from "@/lib/projection";
import { AccountLinesChart } from "./AccountLinesChart";
import { StackedContributionChart } from "./StackedContributionChart";

interface AccountDiagnosticChartProps {
	document: FinancialModelDocument;
	hasStochasticData: boolean;
	stochasticIsProvisional?: boolean;
	chartData: Record<string, string | number>[];
	milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const AccountDiagnosticChart = memo(function AccountDiagnosticChart({
	document,
	hasStochasticData,
	stochasticIsProvisional = false,
	chartData,
	milestoneDates,
}: AccountDiagnosticChartProps) {
	const [viewMode, setViewMode] = useState<"stacked" | "accounts">("stacked");

	return (
		<section>
			<Card className="min-w-0 rounded-[1.8rem] border-border/80 bg-card/92">
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
							className="shrink-0 rounded-lg border border-border/80 bg-surface/75 px-3 py-1 type-label shadow-sm transition hover:border-ring hover:bg-accent hover:text-foreground dark:border-white/10 no-print"
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
							document={document}
							hasStochasticData={hasStochasticData}
							stochasticIsProvisional={stochasticIsProvisional}
							chartData={chartData}
							milestoneDates={milestoneDates}
						/>
					) : (
						<AccountLinesChart document={document} chartData={chartData} />
					)}
				</CardContent>
			</Card>
		</section>
	);
});
