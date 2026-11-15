import { TriangleAlert } from "lucide-react";
import {
	Sheet,
	SheetBody,
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
import {
	type FinancialIndependenceAnalysis,
	type FinancialIndependenceRange,
} from "@/domain/financialIndependence.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { IndependenceConfigure } from "./IndependenceConfigure.tsx";
import { IndependenceDataTable } from "./IndependenceDataTable.tsx";
import { IndependenceEvidence } from "./IndependenceEvidence.tsx";
import { IndependenceOverview } from "./IndependenceOverview.tsx";

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
			<SheetContent side="right">
				<SheetHeader>
					<SheetTitle>{item.name}</SheetTitle>
					<SheetDescription className="sr-only">
						Financial independence detail view
					</SheetDescription>
				</SheetHeader>
				<SheetBody className="flex flex-col gap-4">
					<Tabs defaultValue="overview">
						<TabsList
							variant="line"
							scrollable
							aria-label="Financial independence detail view"
							activateOnFocus
							className="mb-6 gap-6 max-sm:gap-5"
						>
							<TabsTrigger value="overview" className="flex-none">
								Overview
							</TabsTrigger>
							<TabsTrigger value="configure" className="flex-none">
								Configure
							</TabsTrigger>
						</TabsList>
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
						<TabsContent value="configure">
							<div className="grid content-start gap-3">
								<p className="m-0 text-xs text-muted-foreground">
									Minimum net worth, spending test duration, and funding
									sources. Saving recalculates the projection.
								</p>
								<IndependenceConfigure instanceId={item.id} />
							</div>
						</TabsContent>
					</Tabs>
					{!!analysis.diagnostics.length && (
						<details
							className="rounded-xl border border-warning-border bg-warning-bg p-4 text-xs text-warning-text"
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
				</SheetBody>
			</SheetContent>
		</Sheet>
	);
}
