import { type ComponentType, useState } from "react";
import { parseDecimalDraft } from "@/lib/number-draft";
import type {
	EvaluationInstance,
	EvaluationTables,
	EvaluationType,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	isJsonValue,
	validateFinancialIndependencePlan,
	validateNetWorthThresholdConfig,
	validatePostingFulfillmentConfig,
} from "@/lib/projection";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN } from "@/store";
import { EvaluationEditorFooter } from "./_Metric";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";
import { FiNumberField } from "./FinancialIndependencePlanFields";
import { NetWorthThresholdEvaluation } from "./NetWorthThresholdEvaluation";
import { PostingFulfillmentEvaluation } from "./PostingFulfillmentEvaluation";

export interface ConfigEditorProps {
	evaluation: EvaluationInstance<unknown>;
	onChange: (changes: object) => void;
	onDirtyChange?: (dirty: boolean) => void;
}

export interface ResultRendererProps {
	evaluation: EvaluationInstance<unknown>;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	sourceRevision: number;
	resultsAreStale?: boolean;
	blockerValue: string;
	blockerDetail: string;
}

export interface EvaluationUiDefinition {
	label: string;
	defaultLabel: string;
	createConfig: () => unknown;
	validateConfig: (config: unknown) => unknown;
	ConfigEditor?: ComponentType<ConfigEditorProps>;
	ResultRenderer: ComponentType<ResultRendererProps>;
}

function ThresholdConfigEditor({
	evaluation,
	onChange,
	onDirtyChange,
}: ConfigEditorProps) {
	const target = validateNetWorthThresholdConfig(evaluation.config).target;
	const committedDraft = String(target);
	const [draftTarget, setDraftTarget] = useState(committedDraft);
	const [syncedCommittedDraft, setSyncedCommittedDraft] =
		useState(committedDraft);
	if (committedDraft !== syncedCommittedDraft) {
		setSyncedCommittedDraft(committedDraft);
		setDraftTarget(committedDraft);
	}
	const parsedTarget = parseDecimalDraft(draftTarget);
	const dirty = draftTarget !== committedDraft;

	function handleDraftChange(value: string) {
		setDraftTarget(value);
		onDirtyChange?.(value !== committedDraft);
	}

	return (
		<div className="space-y-2">
			<FiNumberField
				label="Target net worth"
				id={`threshold-${evaluation.instanceId}`}
				value={draftTarget}
				step={50_000}
				onChange={handleDraftChange}
			/>
			<EvaluationEditorFooter
				dirty={dirty}
				canSubmit={parsedTarget !== null}
				discardLabel="Discard"
				submitLabel="Update analysis"
				className="flex flex-col gap-2 sm:flex-row sm:justify-end"
				buttonClassName="w-full sm:w-auto min-h-11"
				onDiscard={() => handleDraftChange(committedDraft)}
				onSubmit={() => {
					if (parsedTarget === null) return;
					onChange({ target: parsedTarget });
					setDraftTarget(String(parsedTarget));
				}}
			/>
		</div>
	);
}

export const evaluationUiRegistry: Record<
	EvaluationType,
	EvaluationUiDefinition
> = {
	financialIndependence: {
		label: "Financial independence",
		defaultLabel: "Financial independence",
		createConfig: () => structuredClone(DEFAULT_FINANCIAL_INDEPENDENCE_PLAN),
		validateConfig: validateFinancialIndependencePlan,
		ResultRenderer: FinancialIndependenceEvaluation,
	},
	netWorthThreshold: {
		label: "Net worth threshold",
		defaultLabel: "Reach a net worth target",
		createConfig: () => ({ target: 1_000_000 }),
		validateConfig: validateNetWorthThresholdConfig,
		ConfigEditor: ThresholdConfigEditor,
		ResultRenderer: NetWorthThresholdEvaluation,
	},
	postingFulfillment: {
		label: "Posting fulfillment",
		defaultLabel: "Posting fulfillment",
		createConfig: () => ({ postingIds: null }),
		validateConfig: validatePostingFulfillmentConfig,
		ResultRenderer: PostingFulfillmentEvaluation,
	},
};

export function nextInstanceId(
	type: EvaluationType,
	evaluations: EvaluationTables,
) {
	const idPrefix = type.replace(
		/[A-Z]/g,
		(letter) => `-${letter.toLowerCase()}`,
	);
	let suffix = 1;
	let candidate = `${idPrefix}-${suffix}`;
	while (
		(Object.values(evaluations) as EvaluationInstance<unknown>[][]).some(
			(table) => table.some((item) => item.instanceId === candidate),
		)
	) {
		suffix++;
		candidate = `${idPrefix}-${suffix}`;
	}
	return candidate;
}

export function validatedConfig(type: EvaluationType, config: unknown) {
	try {
		const normalized = evaluationUiRegistry[type].validateConfig(config);
		if (!isJsonValue(normalized))
			throw new Error("Configuration must be JSON-serializable.");
		return { normalized, error: null };
	} catch (error) {
		return {
			normalized: null,
			error: error instanceof Error ? error.message : "Invalid configuration.",
		};
	}
}
