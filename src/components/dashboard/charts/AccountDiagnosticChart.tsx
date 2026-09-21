import { memo, useState } from "react";
import type { StochasticChartRow } from "@/chart/chartData";
import { SectionCard } from "@/components/present/present";
import type { FinancialModelDocument } from "@/lib/projection";
import { AccountLinesChart } from "./AccountLinesChart";
import { StackedContributionChart } from "./StackedContributionChart";

interface AccountDiagnosticChartProps {
	document: FinancialModelDocument;
	hasStochasticData: boolean;
	stochasticIsProvisional?: boolean;
	chartData: Record<string, string | number>[];
	stochasticChartData: StochasticChartRow[] | null;
	milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const AccountDiagnosticChart = memo(function AccountDiagnosticChart({
	document,
	hasStochasticData,
	stochasticIsProvisional = false,
	chartData,
	stochasticChartData,
	milestoneDates,
}: AccountDiagnosticChartProps) {
	const [viewMode, setViewMode] = useState<"stacked" | "accounts">("stacked");

	return (
		<section>
			<SectionCard
				title="Net worth projection"
				action={
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
				}
				className="min-w-0 rounded-[1.8rem] border-border/80 bg-card/92"
				contentClassName="min-w-0"
			>
				{viewMode === "stacked" ? (
					<StackedContributionChart
						document={document}
						hasStochasticData={hasStochasticData}
						stochasticIsProvisional={stochasticIsProvisional}
						chartData={chartData}
						stochasticChartData={stochasticChartData}
						milestoneDates={milestoneDates}
					/>
				) : (
					<AccountLinesChart document={document} chartData={chartData} />
				)}
			</SectionCard>
		</section>
	);
});
