import { type ComponentType, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
	EvaluationInstance,
	EvaluationResultCollection,
	EvaluationTables,
	EvaluationType,
	FinancialIndependencePlan,
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	EVALUATION_TYPE_ORDER,
	isJsonValue,
	validateFinancialIndependencePlan,
	validateNetWorthThresholdConfig,
	validatePostingFulfillmentConfig,
} from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN, useStore } from "@/store";
import { FinancialIndependenceEvaluation } from "./FinancialIndependenceEvaluation";
import { FinancialIndependencePlanEditor } from "./FinancialIndependencePlanEditor";
import { NetWorthThresholdEvaluation } from "./NetWorthThresholdEvaluation";
import { PostingFulfillmentEvaluation } from "./PostingFulfillmentEvaluation";

interface ConfigEditorProps {
	evaluation: EvaluationInstance<unknown>;
	onChange: (changes: object) => void;
	onDirtyChange?: (dirty: boolean) => void;
}

interface ResultRendererProps {
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

interface EvaluationUiDefinition {
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
	const [draftTarget, setDraftTarget] = useState(target);
	useEffect(() => setDraftTarget(target), [target]);
	const dirty = draftTarget !== target;
	const onDirtyChangeRef = useRef(onDirtyChange);
	onDirtyChangeRef.current = onDirtyChange;
	useEffect(() => {
		onDirtyChangeRef.current?.(dirty);
		return () => onDirtyChangeRef.current?.(false);
	}, [dirty]);

	return (
		<div className="space-y-2">
			<label className="block type-caption">
				Target net worth
				<input
					type="number"
					step={50_000}
					value={draftTarget}
					onChange={(event) => setDraftTarget(Number(event.target.value))}
					className="mt-1 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none focus:border-ring dark:border-white/10"
				/>
			</label>
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={!dirty}
					onClick={() => setDraftTarget(target)}
				>
					Discard
				</Button>
				<Button
					type="button"
					size="sm"
					disabled={!dirty || !Number.isFinite(draftTarget)}
					onClick={() => onChange({ target: draftTarget })}
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

function nextInstanceId(type: EvaluationType, evaluations: EvaluationTables) {
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

function validatedConfig(type: EvaluationType, config: unknown) {
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

interface EvaluationResultsProps {
	results?: EvaluationResultCollection | null;
	document: FinancialModelDocument;
	result: ProjectionResult;
	stochasticResult?: StochasticProjectionResult | null;
	stochasticIsProvisional?: boolean;
	sourceRevision?: number;
	resultsAreStale?: boolean;
	blockerValue?: string;
	blockerDetail?: string;
}

export function EvaluationResults({
	results,
	document,
	result,
	stochasticResult,
	stochasticIsProvisional = false,
	sourceRevision = 0,
	resultsAreStale = false,
	blockerValue = "No blocking constraint",
	blockerDetail = "No evaluation blocker was identified.",
}: EvaluationResultsProps) {
	const evaluations = useStore((state) => state.evaluations);
	const resultCollection = resultsAreStale
		? null
		: (stochasticResult ?? results ?? result);

	return (
		<section id="evaluations" className="space-y-4">
			<div>
				<div className="type-eyebrow text-primary">Ordered questions</div>
				<h2 className="mt-1 type-title text-2xl">Evaluations</h2>
				<p className="mt-1 max-w-2xl type-muted">
					Outcomes, behavior evidence, diagnostics, and probabilistic analysis
					for each configured evaluation.
				</p>
			</div>

			{EVALUATION_TYPE_ORDER.map((type) => {
				const definition = evaluationUiRegistry[type];
				const table = evaluations[type] as EvaluationInstance<unknown>[];
				return table.length > 0 ? (
					<div key={type} className="space-y-3">
						<h3 className="type-eyebrow text-muted-foreground">
							{definition.label}
						</h3>
						{table.map((evaluation) => {
							const config = validatedConfig(type, evaluation.config);
							const envelope = resultCollection?.evaluations[type].find(
								(candidate) => candidate.instanceId === evaluation.instanceId,
							);
							const status = evaluation.enabled
								? resultsAreStale
									? "updating"
									: `${stochasticIsProvisional && stochasticResult ? "provisional " : ""}${envelope?.status ?? "pending"}`
								: "disabled";
							const ResultRenderer = definition.ResultRenderer;
							return (
								<Card
									key={evaluation.instanceId}
									className="overflow-hidden rounded-[1.8rem] border-border/80 bg-card/92"
								>
									<CardHeader className="border-b border-border/70 bg-surface/45 dark:border-white/10">
										<div className="flex items-start justify-between gap-4">
											<div>
												<div className="type-title text-xl">
													{evaluation.label}
												</div>
												<div className="mt-1 type-caption">
													{evaluation.instanceId}
												</div>
											</div>
											<span className="rounded-full border border-border/70 px-3 py-1 type-label uppercase tracking-[0.12em]">
												{status}
											</span>
										</div>
									</CardHeader>
									<CardContent className="space-y-4 p-4 md:p-6">
										{config.error ? (
											<Diagnostic message={config.error} error />
										) : null}
										{envelope?.diagnostics.map((diagnostic) => (
											<Diagnostic
												key={`${diagnostic.code}-${diagnostic.message}`}
												message={diagnostic.message}
												error={diagnostic.severity === "error"}
											/>
										))}
										{evaluation.enabled &&
										config.normalized !== null &&
										(!resultsAreStale || type === "financialIndependence") ? (
											<ResultRenderer
												evaluation={{
													...evaluation,
													config: config.normalized,
												}}
												document={document}
												result={result}
												stochasticResult={stochasticResult}
												stochasticIsProvisional={stochasticIsProvisional}
												sourceRevision={sourceRevision}
												resultsAreStale={resultsAreStale}
												blockerValue={blockerValue}
												blockerDetail={blockerDetail}
											/>
										) : resultsAreStale && evaluation.enabled ? (
											<p className="rounded-2xl border border-dashed border-border/80 p-5 type-muted">
												Updating this evaluation with the current settings.
											</p>
										) : null}
									</CardContent>
								</Card>
							);
						})}
					</div>
				) : null;
			})}
		</section>
	);
}

interface EvaluationSettingsProps {
	onDraftDirtyChange: (key: string, dirty: boolean) => void;
}

export function EvaluationSettings({
	onDraftDirtyChange,
}: EvaluationSettingsProps) {
	const {
		document: canonicalDocument,
		effectiveDocument,
		dataUpdatedAt,
	} = useModelRuntime();
	const document = effectiveDocument ?? canonicalDocument;
	const evaluations = useStore((state) => state.evaluations);
	const addEvaluation = useStore((state) => state.addEvaluation);
	const duplicateEvaluation = useStore((state) => state.duplicateEvaluation);
	const updateEvaluation = useStore((state) => state.updateEvaluation);
	const updateEvaluationConfig = useStore(
		(state) => state.updateEvaluationConfig,
	);
	const removeEvaluation = useStore((state) => state.removeEvaluation);
	const moveEvaluation = useStore((state) => state.moveEvaluation);
	if (!document) return null;

	return (
		<section className="space-y-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 className="type-title text-2xl">Evaluations</h2>
					<p className="mt-1 type-muted">
						Choose the questions the projection should answer and configure
						their assumptions.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{EVALUATION_TYPE_ORDER.map((type) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant="secondary"
							onClick={() =>
								addEvaluation(type, {
									instanceId: nextInstanceId(type, evaluations),
									label: evaluationUiRegistry[type].defaultLabel,
									enabled: true,
									config: evaluationUiRegistry[type].createConfig(),
								})
							}
						>
							Add {evaluationUiRegistry[type].label}
						</Button>
					))}
				</div>
			</div>

			{EVALUATION_TYPE_ORDER.map((type) => {
				const definition = evaluationUiRegistry[type];
				const ConfigEditor = definition.ConfigEditor;
				const table = evaluations[type] as EvaluationInstance<unknown>[];
				return (
					<div key={type} className="space-y-3">
						<h3 className="type-eyebrow">{definition.label}</h3>
						{table.map((evaluation, index) => {
							const config = validatedConfig(type, evaluation.config);
							const dirtyKey = `${type}:${evaluation.instanceId}`;
							return (
								<Card
									key={evaluation.instanceId}
									className="rounded-[1.8rem] border-border/80"
								>
									<CardHeader className="border-b border-border/70">
										<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
											<div className="flex min-w-0 items-start gap-3">
												<input
													type="checkbox"
													checked={evaluation.enabled}
													aria-label={`Enable ${evaluation.label}`}
													onChange={(event) =>
														updateEvaluation(type, evaluation.instanceId, {
															enabled: event.target.checked,
														})
													}
													className="mt-2 accent-primary"
												/>
												<div>
													<input
														type="text"
														value={evaluation.label}
														aria-label={`Label for ${evaluation.instanceId}`}
														onChange={(event) =>
															updateEvaluation(type, evaluation.instanceId, {
																label: event.target.value,
															})
														}
														className="max-w-full bg-transparent type-title text-xl outline-none focus:text-primary"
													/>
													<div className="mt-1 type-caption">
														{evaluation.instanceId}
													</div>
												</div>
											</div>
											<div className="flex flex-wrap gap-1">
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() =>
														moveEvaluation(type, evaluation.instanceId, -1)
													}
													disabled={index === 0}
												>
													Up
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() =>
														moveEvaluation(type, evaluation.instanceId, 1)
													}
													disabled={index === table.length - 1}
												>
													Down
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() =>
														duplicateEvaluation(type, evaluation.instanceId)
													}
												>
													Duplicate
												</Button>
												<Button
													type="button"
													size="sm"
													variant="ghost"
													onClick={() => {
														onDraftDirtyChange(dirtyKey, false);
														removeEvaluation(type, evaluation.instanceId);
													}}
												>
													Remove
												</Button>
											</div>
										</div>
									</CardHeader>
									<CardContent className="space-y-4 p-4 md:p-6">
										{config.error ? (
											<Diagnostic message={config.error} error />
										) : null}
										{ConfigEditor && config.normalized !== null ? (
											<div className="max-w-sm">
												<ConfigEditor
													evaluation={{
														...evaluation,
														config: config.normalized,
													}}
													onChange={(changes) =>
														updateEvaluationConfig(
															type,
															evaluation.instanceId,
															changes,
														)
													}
													onDirtyChange={(dirty) =>
														onDraftDirtyChange(dirtyKey, dirty)
													}
												/>
											</div>
										) : null}
										{type === "financialIndependence" &&
										config.normalized !== null ? (
											<FinancialIndependencePlanEditor
												document={document}
												plan={
													config.normalized as unknown as FinancialIndependencePlan
												}
												sourceRevision={dataUpdatedAt}
												onApply={(changes) =>
													updateEvaluationConfig(
														type,
														evaluation.instanceId,
														changes,
													)
												}
												onDirtyChange={(dirty) =>
													onDraftDirtyChange(dirtyKey, dirty)
												}
											/>
										) : null}
									</CardContent>
								</Card>
							);
						})}
					</div>
				);
			})}
		</section>
	);
}

function Diagnostic({
	message,
	error = false,
}: {
	message: string;
	error?: boolean;
}) {
	return (
		<p
			role={error ? "alert" : "status"}
			className={`rounded-xl border px-3 py-2 type-caption ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border/70"}`}
		>
			{message}
		</p>
	);
}
