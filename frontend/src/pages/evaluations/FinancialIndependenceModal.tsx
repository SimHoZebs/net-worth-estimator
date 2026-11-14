import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet.tsx";
import {
	Tabs,
	TabsList,
	TabsTrigger,
	TabsContent,
} from "@/components/ui/tabs.tsx";
import { cn } from "@/lib/utils.ts";
import {
	type FinancialIndependenceAnalysis,
	type FinancialIndependenceRange,
} from "@/domain/financialIndependence.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { IndependenceConfigure } from "./IndependenceConfigure.tsx";
import { IndependenceDataTable } from "./IndependenceDataTable.tsx";
import { IndependenceEvidence } from "./IndependenceEvidence.tsx";
import { IndependenceOverview } from "./IndependenceOverview.tsx";

type InspectorTab = "overview" | "configure";

export function FinancialIndependenceModal({
	item,
	analysis,
	range,
	onClose,
}: {
	item: OtherEvaluation;
	analysis: FinancialIndependenceAnalysis;
	range: FinancialIndependenceRange | null;
	onClose: () => void;
}) {
	const [tab, setTab] = useState<InspectorTab>("overview");
	const candidate =
		analysis.candidates.find((row) => row.date === analysis.defaultDate) ??
		analysis.candidates[0];
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent side="right" className="overflow-y-auto sm:max-w-3xl">
				<SheetHeader className="border-b-0 p-4 pb-2">
					<SheetTitle>{item.name}</SheetTitle>
					<SheetDescription className="sr-only">
						Financial independence detail view
					</SheetDescription>
				</SheetHeader>
				<div className="flex flex-col gap-4 px-4 pb-4">
					<Tabs
						value={tab}
						onValueChange={(value) => setTab(value as InspectorTab)}
					>
						<TabsList
							variant="line"
							aria-label="Financial independence detail view"
							className={cn(
								"mb-6 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0 max-sm:gap-5",
							)}
						>
							<TabsTrigger
								value="overview"
								className={cn(
									"flex h-auto flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
									"focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
								)}
							>
								Overview
							</TabsTrigger>
							<TabsTrigger
								value="configure"
								className={cn(
									"flex h-auto flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
									"focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
								)}
							>
								Configure
							</TabsTrigger>
						</TabsList>
						{tab === "overview" ? (
							<TabsContent value="overview">
								<div className="grid content-start gap-6">
									<IndependenceOverview
										analysis={analysis}
										range={range}
										candidate={candidate}
									/>
									{candidate && (
										<IndependenceEvidence
											candidate={candidate}
											analysis={analysis}
										/>
									)}
									<IndependenceDataTable analysis={analysis} />
								</div>
							</TabsContent>
						) : (
							<TabsContent value="configure">
								<div className="grid content-start gap-3">
									<p className="m-0 text-xs text-muted">
										Minimum net worth, spending test duration, and funding
										sources. Saving recalculates the projection.
									</p>
									<IndependenceConfigure instanceId={item.id} />
								</div>
							</TabsContent>
						)}
					</Tabs>
					{!!analysis.diagnostics.length && (
						<details
							className="rounded-surface border border-warning-border bg-warning-bg p-4 text-xs text-warning-text"
							open
						>
							<summary className="cursor-pointer">
								<TriangleAlert
									size={14}
									className="mr-1 inline"
									aria-hidden="true"
								/>
								{analysis.diagnostics.length} source or configuration{" "}
								{analysis.diagnostics.length === 1 ? "issue" : "issues"}
							</summary>
							<ul className="mb-0 mt-2 pl-4">
								{analysis.diagnostics.map((diagnostic, index) => (
									<li key={`${diagnostic.code}-${index}`}>
										{diagnostic.code === "missing-financial-independence-source"
											? "A selected funding source is unavailable and was excluded."
											: diagnostic.message}
										{diagnostic.relatedAccountIds
											?.map((id) => ` ${analysis.accountNames[id] ?? id}`)
											.join(", ")}
										{diagnostic.relatedTransactionIds?.length
											? ` Transactions: ${diagnostic.relatedTransactionIds.join(", ")}`
											: ""}
									</li>
								))}
							</ul>
						</details>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
