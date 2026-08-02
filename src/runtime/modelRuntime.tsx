import { createContext, type ReactNode, useContext } from "react";
import type { TemplateOutput } from "@/lib/patterns";
import type {
	FinancialModelDocument,
	IncomeDataSnapshot,
	ModelValidationIssue,
} from "@/lib/projection";

export interface ModelSourceInfo {
	label: string;
	description: string;
	sourceType: string;
	saveLabel: string | null;
	resetLabel: string | null;
}

export interface ModelRuntime {
	source: ModelSourceInfo;
	document: FinancialModelDocument | null;
	incomeData: IncomeDataSnapshot | null;
	effectiveDocument: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
	validationIsValid: boolean;
	loadError: string | null;
	sourceActionError: string | null;
	isLoading: boolean;
	isSourceUpdating: boolean;
	dataUpdatedAt: number;
	projectionStartDate: string;
	isSaving: boolean;
	isResetting: boolean;
	reload: () => void;
	save: () => void;
	reset?: () => void;
	applyTemplate: (output: TemplateOutput) => void;
}

const ModelRuntimeContext = createContext<ModelRuntime | null>(null);

export function ModelRuntimeProvider({
	value,
	children,
}: {
	value: ModelRuntime;
	children: ReactNode;
}) {
	return (
		<ModelRuntimeContext.Provider value={value}>
			{children}
		</ModelRuntimeContext.Provider>
	);
}

export function useModelRuntime() {
	const runtime = useContext(ModelRuntimeContext);
	if (!runtime)
		throw new Error("useModelRuntime requires ModelRuntimeProvider.");
	return runtime;
}
