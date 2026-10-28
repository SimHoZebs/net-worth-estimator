import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Drawer } from "@/components/Drawer.tsx";
import { Tabs } from "@/components/Tabs.tsx";
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
const tabs = [
	{ id: "overview", label: "Overview" },
	{ id: "configure", label: "Configure" },
] as const;

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
		<Drawer
			side="right"
			open
			onClose={onClose}
			label={item.name}
			appearance={{
				title: item.name,
				coverage: "full",
				headerClassName: "border-b-0 pb-2",
				bodyClassName: "pt-0",
			}}
		>
			<Tabs
				items={tabs}
				value={tab}
				onChange={setTab}
				label="Financial independence detail view"
				className="mb-4"
			>
				{tab === "overview" && (
					<div className="grid content-start gap-6">
						<IndependenceOverview
							analysis={analysis}
							range={range}
							candidate={candidate}
						/>
						{candidate && (
							<IndependenceEvidence candidate={candidate} analysis={analysis} />
						)}
						<IndependenceDataTable analysis={analysis} />
					</div>
				)}
				{tab === "configure" && (
					<div className="grid content-start gap-3">
						<p className="m-0 text-xs text-muted">
							Minimum net worth, spending test duration, and funding sources.
							Saving recalculates the projection.
						</p>
						<IndependenceConfigure instanceId={item.id} />
					</div>
				)}
			</Tabs>
			{!!analysis.diagnostics.length && (
				<details
					className="mt-4 rounded-surface border border-warning-border bg-warning-bg p-4 text-xs text-warning-text"
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
								{diagnostic.relatedPostingIds?.length
									? ` Transactions: ${diagnostic.relatedPostingIds.join(", ")}`
									: ""}
							</li>
						))}
					</ul>
				</details>
			)}
		</Drawer>
	);
}
