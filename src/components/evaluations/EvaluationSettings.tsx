import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type {
	EvaluationInstance,
	FinancialIndependencePlan,
} from "@/lib/projection";
import { EVALUATION_TYPE_ORDER } from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useStore } from "@/store";
import {
	evaluationUiRegistry,
	nextInstanceId,
	validatedConfig,
} from "./evaluationUiRegistry";
import { FinancialIndependencePlanEditor } from "./FinancialIndependencePlanEditor";

export interface EvaluationSettingsProps {
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
														className="max-w-full bg-transparent type-title text-xl outline-none focus:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
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
											<p
												role="alert"
												className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 type-caption text-destructive"
											>
												{config.error}
											</p>
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
