import { useCallback, useState } from "react";
import { ModelInputsInspector } from "@/components/ModelInputsInspector";
import { TemplateWizard } from "@/components/patterns/TemplateWizard";
import { Button } from "@/components/ui/Button";
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
			<div className="flex justify-end">
				<h1 className="sr-only">Model inputs</h1>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					className="min-h-11"
					onClick={() => setShowWizard(true)}
					disabled={!wizardDocument}
				>
					Templates
				</Button>
			</div>

			<div className="mx-auto w-full max-w-5xl">
				<ModelInputsInspector />
			</div>

			{showWizard && wizardDocument ? (
				<TemplateWizard
					document={wizardDocument}
					incomeData={model.incomeData}
					onApply={model.applyTemplate}
					onClose={handleCloseWizard}
				/>
			) : null}
		</main>
	);
}
