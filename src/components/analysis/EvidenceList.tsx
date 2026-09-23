import type { EvidenceItem } from "@/lib/analysis";
import { diagnosticPresentation } from "@/lib/analysis/analysisDisplay";
import type { AnalysisDiagnostic } from "@/lib/analysis/types";

const SEVERITY_GLYPH: Record<AnalysisDiagnostic["severity"], string> = {
	error: "✕",
	warning: "▲",
	info: "●",
};

export function DiagnosticsList({
	diagnostics,
}: {
	diagnostics: readonly AnalysisDiagnostic[];
}) {
	if (diagnostics.length === 0) return null;
	return (
		<div className="space-y-2">
			{diagnostics.map((diagnostic) => {
				const presentation = diagnosticPresentation(diagnostic.severity);
				return (
					<div
						key={`${diagnostic.code}-${diagnostic.message}`}
						role={presentation.role}
						className={`flex items-start gap-2 ${presentation.containerClassName}`}
					>
						<span aria-hidden="true" className="font-bold">
							{SEVERITY_GLYPH[diagnostic.severity]}
						</span>
						<span>
							<span className="sr-only">{presentation.label}: </span>
							{diagnostic.message}
						</span>
					</div>
				);
			})}
		</div>
	);
}

export function EvidenceItemList({
	items,
}: {
	items: readonly EvidenceItem[];
}) {
	if (items.length === 0) return null;
	return (
		<ul className="space-y-1.5">
			{items.map((item) => (
				<li
					key={item.code}
					className="rounded-lg border border-border/60 bg-surface/50 px-2.5 py-1.5 type-caption"
				>
					<span className="font-medium">
						{evidenceSourceLabel(item.source)} ·{" "}
					</span>
					{item.message}
					<span className="ml-1 opacity-70">({item.strength})</span>
				</li>
			))}
		</ul>
	);
}

function evidenceSourceLabel(source: EvidenceItem["source"]): string {
	if (source === "lexical") return "Wording";
	if (source === "rail") return "Rail";
	if (source === "behavioral") return "Timing";
	if (source === "user") return "Model";
	return "Source";
}
