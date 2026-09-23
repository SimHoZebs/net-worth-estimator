import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
	EmptyState,
	PageHeader,
	Pill,
	SectionCard,
} from "@/components/present/present";
import { Button } from "@/components/ui/button";
import type {
	EvaluationInstance,
	EvaluationType,
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

	// Dirty draft keys mirror the parent's blocker set so cards can badge
	// "Previewing saved analysis" while a draft differs from the applied
	// config. Recalculating keys flash briefly after instant-apply actions.
	const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<string>>(new Set());
	const [recalcKeys, setRecalcKeys] = useState<ReadonlySet<string>>(new Set());
	const recalcTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
	useEffect(
		() => () => {
			recalcTimers.current.forEach((timer) => {
				clearTimeout(timer);
			});
			recalcTimers.current.clear();
		},
		[],
	);

	const notifyDirty = (key: string, dirty: boolean) => {
		setDirtyKeys((current) => {
			if (current.has(key) === dirty) return current;
			const next = new Set(current);
			if (dirty) next.add(key);
			else next.delete(key);
			return next;
		});
		onDraftDirtyChange(key, dirty);
	};

	const flashRecalculating = (key: string) => {
		setRecalcKeys((current) => new Set(current).add(key));
		const existing = recalcTimers.current.get(key);
		if (existing !== undefined) clearTimeout(existing);
		recalcTimers.current.set(
			key,
			setTimeout(() => {
				recalcTimers.current.delete(key);
				setRecalcKeys((current) => {
					const next = new Set(current);
					next.delete(key);
					return next;
				});
			}, 2000),
		);
	};

	const handleAdd = (type: EvaluationType) => {
		const instanceId = nextInstanceId(type, evaluations);
		addEvaluation(type, {
			instanceId,
			label: evaluationUiRegistry[type].defaultLabel,
			enabled: true,
			config: evaluationUiRegistry[type].createConfig(),
		});
		flashRecalculating(`${type}:${instanceId}`);
	};

	if (!document) return null;

	return (
		<section className="space-y-4">
			<PageHeader
				level="h2"
				title="Goals"
				titleClassName="mt-1 type-title text-2xl"
				description="Choose the questions the projection should answer and configure their assumptions."
				descriptionClassName="mt-1 type-muted"
				actions={
					<div className="flex flex-wrap items-center gap-2">
						<Link
							to="/"
							className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
						>
							View results on Results →
						</Link>
						{EVALUATION_TYPE_ORDER.map((type) => (
							<Button
								key={type}
								type="button"
								size="sm"
								variant="secondary"
								onClick={() => handleAdd(type)}
							>
								Add {evaluationUiRegistry[type].label}
							</Button>
						))}
					</div>
				}
			/>

			{EVALUATION_TYPE_ORDER.map((type) => {
				const definition = evaluationUiRegistry[type];
				const ConfigEditor = definition.ConfigEditor;
				const table = evaluations[type] as EvaluationInstance<unknown>[];
				return (
					<div key={type} className="space-y-3">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<h3 className="type-eyebrow">{definition.label}</h3>
							{table.length > 1 ? (
								<span className="type-caption text-muted-foreground">
									Order sets the sequence shown on Results.
								</span>
							) : null}
						</div>
						{table.length === 0 ? (
							<EmptyState>
								<p>No {definition.label.toLowerCase()} analyses yet.</p>
								<Button
									type="button"
									size="sm"
									className="mt-3 min-h-11"
									onClick={() => handleAdd(type)}
								>
									Add {definition.label}
								</Button>
							</EmptyState>
						) : (
							table.map((evaluation, index) => {
								const config = validatedConfig(type, evaluation.config);
								const dirtyKey = `${type}:${evaluation.instanceId}`;
								const isDirty = dirtyKeys.has(dirtyKey);
								const isRecalculating = recalcKeys.has(dirtyKey);
								return (
									<SectionCard
										key={evaluation.instanceId}
										className="rounded-[1.8rem] border-border/80"
										headerClassName="border-b border-border/70"
										header={
											<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
												<div className="flex min-w-0 items-start gap-3">
													<input
														type="checkbox"
														checked={evaluation.enabled}
														aria-label={`Enable ${evaluation.label}`}
														onChange={(event) => {
															updateEvaluation(type, evaluation.instanceId, {
																enabled: event.target.checked,
															});
															flashRecalculating(dirtyKey);
														}}
														className="mt-2 accent-primary"
													/>
													<div className="min-w-0">
														<input
															type="text"
															value={evaluation.label}
															title={evaluation.instanceId}
															aria-label={`Label for ${evaluation.label}`}
															onChange={(event) => {
																updateEvaluation(type, evaluation.instanceId, {
																	label: event.target.value,
																});
																flashRecalculating(dirtyKey);
															}}
															className="max-w-full bg-transparent type-title text-xl outline-none focus:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
														/>
														<div className="mt-1 flex flex-wrap items-center gap-2">
															{isRecalculating ? (
																<Pill tone="primary" size="xs">
																	<span role="status">Recalculating…</span>
																</Pill>
															) : null}
															{isDirty ? (
																<Pill tone="tertiary" size="xs">
																	Previewing saved analysis
																</Pill>
															) : null}
															{evaluation.enabled ? null : (
																<Pill size="xs">Disabled</Pill>
															)}
														</div>
													</div>
												</div>
												<div className="flex flex-wrap gap-1">
													<Button
														type="button"
														size="sm"
														variant="ghost"
														title="Move earlier — order sets the Results sequence"
														onClick={() => {
															moveEvaluation(type, evaluation.instanceId, -1);
															flashRecalculating(dirtyKey);
														}}
														disabled={index === 0}
													>
														Up
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														title="Move later — order sets the Results sequence"
														onClick={() => {
															moveEvaluation(type, evaluation.instanceId, 1);
															flashRecalculating(dirtyKey);
														}}
														disabled={index === table.length - 1}
													>
														Down
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														onClick={() => {
															duplicateEvaluation(type, evaluation.instanceId);
															flashRecalculating(dirtyKey);
														}}
													>
														Duplicate
													</Button>
													<Button
														type="button"
														size="sm"
														variant="ghost"
														onClick={() => {
															notifyDirty(dirtyKey, false);
															removeEvaluation(type, evaluation.instanceId);
														}}
													>
														Remove
													</Button>
												</div>
											</div>
										}
										contentClassName="space-y-4 p-4 md:p-6"
									>
										{type === "postingFulfillment" ? (
											<p className="type-caption text-muted-foreground">
												Fundability is computed from model data — no
												configuration needed.
											</p>
										) : null}
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
													onChange={(changes) => {
														updateEvaluationConfig(
															type,
															evaluation.instanceId,
															changes,
														);
														notifyDirty(dirtyKey, false);
														flashRecalculating(dirtyKey);
													}}
													onDirtyChange={(dirty) =>
														notifyDirty(dirtyKey, dirty)
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
												onApply={(changes) => {
													updateEvaluationConfig(
														type,
														evaluation.instanceId,
														changes,
													);
													notifyDirty(dirtyKey, false);
													flashRecalculating(dirtyKey);
												}}
												onDirtyChange={(dirty) => notifyDirty(dirtyKey, dirty)}
											/>
										) : null}
									</SectionCard>
								);
							})
						)}
					</div>
				);
			})}
		</section>
	);
}
