import { useCallback, useState } from "react";
import { ModelInputsInspector } from "@/components/ModelInputsInspector";
import { TemplateWizard } from "@/components/patterns/TemplateWizard";
import { SourceStatusCard } from "@/components/sidebar/SourceStatusCard";
import { Button } from "@/components/ui/button";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useStore } from "@/store";

export function ModelInputsPage() {
	const model = useModelRuntime();
	const [showWizard, setShowWizard] = useState(false);
	const workingDocument = useStore((state) => state.workingDocument);
	const wizardDocument = workingDocument ?? model.document;
	const handleCloseWizard = useCallback(() => setShowWizard(false), []);

	return (
		<main className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="type-eyebrow text-primary">Source model</div>
					<h1 className="mt-1 type-title text-3xl">Model inputs</h1>
					<p className="mt-1 max-w-2xl type-muted">
						Maintain baseline accounts, scheduled transactions, balance history,
						and temporary changes.
					</p>
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setShowWizard(true)}
					disabled={!wizardDocument}
				>
					Add from template
				</Button>
			</div>

			<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<ModelInputsInspector />
				<SourceStatusCard />
			</div>

			{showWizard && wizardDocument ? (
				<TemplateWizard
					document={wizardDocument}
					onApply={model.applyTemplate}
					onClose={handleCloseWizard}
				/>
			) : null}
		</main>
	);
}
