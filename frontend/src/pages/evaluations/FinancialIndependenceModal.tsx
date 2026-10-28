import { TriangleAlert } from "lucide-react";
import { Drawer } from "@/components/Drawer.tsx";
import {
	type FinancialIndependenceAnalysis,
	type FinancialIndependenceRange,
} from "@/domain/financialIndependence.ts";
import { dateLabel } from "@/domain/format.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { IndependenceDataTable } from "./IndependenceDataTable.tsx";
import { IndependenceConfigureSection } from "./IndependenceConfigure.tsx";
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
				eyebrow: analysis.endDate
					? `${dateLabel(analysis.startDate, true)} – ${dateLabel(analysis.endDate, true)}`
					: undefined,
			}}
		>
			<div className="grid content-start gap-6">
				<IndependenceOverview
					analysis={analysis}
					range={range}
					candidate={candidate}
				/>
				<IndependenceConfigureSection instanceId={item.id} />
				{candidate && (
					<IndependenceEvidence candidate={candidate} analysis={analysis} />
				)}
				<IndependenceDataTable analysis={analysis} />
			</div>
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
