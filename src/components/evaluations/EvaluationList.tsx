import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
	ConfiguredEvaluation,
	EvaluationResultCollection,
	FinancialModelDocument,
	JsonValue,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	isJsonValue,
	validateFinancialIndependencePlan,
	validateNetWorthThresholdConfig,
	validatePostingFulfillmentConfig,
} from "@/lib/projection";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN, useStore } from "@/store";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";
import { NetWorthThresholdEvaluation } from "./NetWorthThresholdEvaluation";
import { PostingFulfillmentEvaluation } from "./PostingFulfillmentEvaluation";

interface ConfigEditorProps {
	evaluation: ConfiguredEvaluation;
	onChange: (changes: object) => void;
}

interface ResultRendererProps {
	evaluation: ConfiguredEvaluation;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	blockerValue: string;
	blockerDetail: string;
}

interface EvaluationUiDefinition {
	id: string;
	label: string;
	defaultLabel: string;
	createConfig: () => JsonValue;
	validateConfig: (config: unknown) => JsonValue;
	ConfigEditor?: ComponentType<ConfigEditorProps>;
	ResultRenderer: ComponentType<ResultRendererProps>;
}

function ThresholdConfigEditor({ evaluation, onChange }: ConfigEditorProps) {
	const target = validateNetWorthThresholdConfig(evaluation.config).target;
	return (
		<label className="block type-caption">
			Target net worth
			<input
				type="number"
				step={50_000}
				value={target}
				onChange={(event) => onChange({ target: Number(event.target.value) })}
				className="mt-1 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none focus:border-ring dark:border-white/10"
			/>
		</label>
	);
}

export const evaluationUiRegistry: readonly EvaluationUiDefinition[] = [
	{
		id: "financial-independence",
		label: "Financial independence",
		defaultLabel: "Financial independence",
		createConfig: () =>
			structuredClone(
				DEFAULT_FINANCIAL_INDEPENDENCE_PLAN,
			) as unknown as JsonValue,
		validateConfig: (config) =>
			validateFinancialIndependencePlan(config) as unknown as JsonValue,
		ResultRenderer: FinancialIndependenceEvaluation,
	},
	{
		id: "net-worth-threshold",
		label: "Net worth threshold",
		defaultLabel: "Reach a net worth target",
		createConfig: () => ({ target: 1_000_000 }),
		validateConfig: (config) =>
			validateNetWorthThresholdConfig(config) as unknown as JsonValue,
		ConfigEditor: ThresholdConfigEditor,
		ResultRenderer: NetWorthThresholdEvaluation,
	},
	{
		id: "posting-fulfillment",
		label: "Posting fulfillment",
		defaultLabel: "Posting fulfillment",
		createConfig: () => ({ postingIds: null }),
		validateConfig: (config) =>
			validatePostingFulfillmentConfig(config) as unknown as JsonValue,
		ResultRenderer: PostingFulfillmentEvaluation,
	},
];

function nextInstanceId(
	definitionId: string,
	evaluations: readonly ConfiguredEvaluation[],
) {
	let suffix = 1;
	let candidate = `${definitionId}-${suffix}`;
	while (evaluations.some((item) => item.instanceId === candidate)) {
		suffix++;
		candidate = `${definitionId}-${suffix}`;
	}
	return candidate;
}

export function EvaluationList({
	results,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	blockerValue = "No blocking constraint",
	blockerDetail = "No evaluation blocker was identified.",
}: {
	results?: EvaluationResultCollection | null;
	document?: FinancialModelDocument;
	result?: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	blockerValue?: string;
	blockerDetail?: string;
}) {
	const evaluations = useStore((state) => state.evaluations);
	const addEvaluation = useStore((state) => state.addEvaluation);
	const duplicateEvaluation = useStore((state) => state.duplicateEvaluation);
	const updateEvaluation = useStore((state) => state.updateEvaluation);
	const updateEvaluationConfig = useStore(
		(state) => state.updateEvaluationConfig,
	);
	const removeEvaluation = useStore((state) => state.removeEvaluation);
	const moveEvaluation = useStore((state) => state.moveEvaluation);
	const resultCollection = stochasticResult ?? results ?? result;

	return (
		<section id="evaluations" className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="type-eyebrow text-primary">Ordered questions</div>
					<h2 className="mt-1 type-title text-2xl">Evaluations</h2>
					<p className="mt-1 max-w-2xl type-muted">
						Configuration, outcomes, behavior evidence, and probabilistic
						analysis stay together for each configured instance.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 no-print">
					{evaluationUiRegistry.map((definition) => (
						<Button
							key={definition.id}
							type="button"
							size="sm"
							variant="secondary"
							onClick={() =>
								addEvaluation({
									definitionId: definition.id,
									instanceId: nextInstanceId(definition.id, evaluations),
									label: definition.defaultLabel,
									enabled: true,
									config: definition.createConfig(),
								})
							}
						>
							Add {definition.label}
						</Button>
					))}
				</div>
			</div>

			{evaluations.map((evaluation, index) => {
				const uiDefinition = evaluationUiRegistry.find(
					(definition) => definition.id === evaluation.definitionId,
				);
				const ConfigEditor = uiDefinition?.ConfigEditor;
				const ResultRenderer = uiDefinition?.ResultRenderer;
				let normalizedConfig: JsonValue | null = null;
				let configError: string | null = null;
				try {
					normalizedConfig = uiDefinition
						? uiDefinition.validateConfig(evaluation.config)
						: evaluation.config;
					if (!isJsonValue(normalizedConfig)) {
						throw new Error("Configuration must be JSON-serializable.");
					}
				} catch (error) {
					configError =
						error instanceof Error ? error.message : "Invalid configuration.";
				}
				const envelope = resultCollection?.evaluations[evaluation.instanceId];
				const statusLabel = evaluation.enabled
					? `${stochasticIsProvisional && stochasticResult ? "provisional " : ""}${envelope?.status ?? "pending"}`
					: "disabled";

				return (
					<Card
						key={evaluation.instanceId}
						className="overflow-hidden rounded-[1.8rem] border-border/80 bg-card/92"
					>
						<CardHeader className="border-b border-border/70 bg-surface/45 dark:border-white/10">
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div className="flex min-w-0 items-start gap-3">
									<input
										type="checkbox"
										checked={evaluation.enabled}
										aria-label={`Enable ${evaluation.label}`}
										onChange={(event) =>
											updateEvaluation(evaluation.instanceId, {
												enabled: event.target.checked,
											})
										}
										className="mt-2 accent-primary"
									/>
									<div className="min-w-0">
										<input
											type="text"
											value={evaluation.label}
											aria-label={`Label for ${evaluation.instanceId}`}
											onChange={(event) =>
												updateEvaluation(evaluation.instanceId, {
													label: event.target.value,
												})
											}
											className="min-w-0 max-w-full bg-transparent type-title text-xl outline-none focus:text-primary"
										/>
										<div className="mt-1 type-caption">
											{uiDefinition?.label ?? evaluation.definitionId} ·{" "}
											{evaluation.instanceId}
										</div>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-1 no-print">
									<span className="mr-2 rounded-full border border-border/70 px-3 py-1 type-label uppercase tracking-[0.12em]">
										{statusLabel}
									</span>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => moveEvaluation(evaluation.instanceId, -1)}
										disabled={index === 0}
									>
										Up
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => moveEvaluation(evaluation.instanceId, 1)}
										disabled={index === evaluations.length - 1}
									>
										Down
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => duplicateEvaluation(evaluation.instanceId)}
									>
										Duplicate
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										onClick={() => removeEvaluation(evaluation.instanceId)}
									>
										Remove
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-4 p-4 md:p-6">
							{configError ? (
								<p
									role="alert"
									className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 type-caption text-destructive"
								>
									{configError}
								</p>
							) : null}
							{envelope?.diagnostics.map((diagnostic) => (
								<p
									key={`${diagnostic.code}-${diagnostic.message}`}
									role={diagnostic.severity === "error" ? "alert" : "status"}
									className="rounded-xl border border-border/70 px-3 py-2 type-caption"
								>
									{diagnostic.message}
								</p>
							))}
							{ConfigEditor && normalizedConfig !== null ? (
								<div className="max-w-sm">
									<div className="mb-2 type-eyebrow">
										Evaluation configuration
									</div>
									<ConfigEditor
										evaluation={{ ...evaluation, config: normalizedConfig }}
										onChange={(changes) =>
											updateEvaluationConfig(evaluation.instanceId, changes)
										}
									/>
								</div>
							) : null}
							{evaluation.enabled &&
							normalizedConfig !== null &&
							ResultRenderer &&
							document &&
							result ? (
								<ResultRenderer
									evaluation={{ ...evaluation, config: normalizedConfig }}
									document={document}
									result={result}
									stochasticResult={stochasticResult}
									stochasticIsProvisional={stochasticIsProvisional}
									blockerValue={blockerValue}
									blockerDetail={blockerDetail}
								/>
							) : null}
						</CardContent>
					</Card>
				);
			})}
		</section>
	);
}
