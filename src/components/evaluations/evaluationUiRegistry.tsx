import { type ComponentType, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";
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
	useEffect(() => setDraftTarget(committedDraft), [committedDraft]);
	const parsedTarget = parseDecimalDraft(draftTarget);
	const dirty = draftTarget !== committedDraft;
	const onDirtyChangeRef = useRef(onDirtyChange);
	onDirtyChangeRef.current = onDirtyChange;
	useEffect(() => {
		onDirtyChangeRef.current?.(dirty);
		return () => onDirtyChangeRef.current?.(false);
	}, [dirty]);

	return (
		<div className="space-y-2">
			<label
				className="block type-caption"
				htmlFor={`threshold-${evaluation.instanceId}`}
			>
				Target net worth
				<input
					id={`threshold-${evaluation.instanceId}`}
					type="text"
					inputMode="decimal"
					step={50_000}
					value={draftTarget}
					onChange={(event) => setDraftTarget(event.target.value)}
					className="mt-1 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-white/10"
				/>
			</label>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={!dirty}
					onClick={() => setDraftTarget(committedDraft)}
				>
					Discard
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={!dirty || parsedTarget === null}
					onClick={() => {
						if (parsedTarget === null) return;
						onChange({ target: parsedTarget });
						setDraftTarget(String(parsedTarget));
					}}
				>
					Update analysis
				</Button>
			</div>
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
