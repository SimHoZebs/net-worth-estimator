import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type ConfiguredEvaluation,
	type EvaluationResultCollection,
	isJsonValue,
	type JsonValue,
	validateFinancialIndependencePlan,
	validateNetWorthThresholdConfig,
} from "@/lib/projection";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN, useStore } from "@/store";

interface ConfigEditorProps {
	evaluation: ConfiguredEvaluation;
	onChange: (changes: object) => void;
}

interface EvaluationUiDefinition {
	id: string;
	label: string;
	defaultLabel: string;
	createConfig: () => JsonValue;
	validateConfig: (config: unknown) => JsonValue;
	ConfigEditor?: ComponentType<ConfigEditorProps>;
}

function ThresholdConfigEditor({ evaluation, onChange }: ConfigEditorProps) {
	const target =
		typeof evaluation.config === "object" &&
		evaluation.config !== null &&
		"target" in evaluation.config &&
		typeof evaluation.config.target === "number"
			? evaluation.config.target
			: 0;
	return (
		<label className="mt-2 block type-caption">
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
	},
	{
		id: "net-worth-threshold",
		label: "Net worth threshold",
		defaultLabel: "Reach a net worth target",
		createConfig: () => ({ target: 1_000_000 }),
		validateConfig: (config) =>
			validateNetWorthThresholdConfig(config) as unknown as JsonValue,
		ConfigEditor: ThresholdConfigEditor,
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
}: {
	results?: EvaluationResultCollection | null;
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

	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Evaluations</CardTitle>
				<CardDescription>
					Ordered questions evaluated against every projection path.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{evaluations.map((evaluation, index) => {
					const uiDefinition = evaluationUiRegistry.find(
						(definition) => definition.id === evaluation.definitionId,
					);
					const ConfigEditor = uiDefinition?.ConfigEditor;
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
					const envelope = results?.evaluations[evaluation.instanceId];
					return (
						<div
							key={evaluation.instanceId}
							className="rounded-2xl border border-border/70 bg-surface/70 p-3 dark:border-white/10"
						>
							<div className="flex items-start gap-2">
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
								<input
									type="text"
									value={evaluation.label}
									aria-label={`Label for ${evaluation.instanceId}`}
									onChange={(event) =>
										updateEvaluation(evaluation.instanceId, {
											label: event.target.value,
										})
									}
									className="min-w-0 flex-1 rounded-xl border border-border/80 bg-card/85 px-3 py-1.5 text-sm shadow-sm outline-none focus:border-ring dark:border-white/10"
								/>
							</div>
							<div className="mt-1 pl-6 type-caption">
								{uiDefinition?.label ?? evaluation.definitionId} ·{" "}
								{evaluation.instanceId}
							</div>
							{configError ? (
								<p
									role="alert"
									className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2 py-1 type-caption text-destructive"
								>
									{configError}
								</p>
							) : null}
							{envelope?.diagnostics.map((diagnostic) => (
								<p
									key={`${diagnostic.code}-${diagnostic.message}`}
									role={diagnostic.severity === "error" ? "alert" : "status"}
									className="mt-2 rounded-lg border border-border/70 px-2 py-1 type-caption"
								>
									{diagnostic.message}
								</p>
							))}
							{ConfigEditor && normalizedConfig !== null ? (
								<div className="pl-6">
									<ConfigEditor
										evaluation={{
											...evaluation,
											config: normalizedConfig,
										}}
										onChange={(changes) =>
											updateEvaluationConfig(evaluation.instanceId, changes)
										}
									/>
								</div>
							) : null}
							<div className="mt-3 flex flex-wrap gap-1 pl-6">
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
					);
				})}
				<div className="flex flex-wrap gap-2">
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
			</CardContent>
		</Card>
	);
}
