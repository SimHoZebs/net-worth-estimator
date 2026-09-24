import { type ComponentType, useEffect, useRef, useState } from "react";
import { EmptyState, Pill, SectionCard } from "@/components/present/Present";
import { Button } from "@/components/ui/Button";
import type {
	EvaluationInstance,
	EvaluationType,
	FinancialIndependencePlan,
	FinancialModelDocument,
} from "@/lib/projection";
import { EVALUATION_TYPE_ORDER } from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useStore } from "@/store";
import {
	type ConfigEditorProps,
	evaluationUiRegistry,
	nextInstanceId,
	validatedConfig,
} from "./EvaluationUiRegistry";
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
	// unsaved edits. Recalculating keys flash briefly after instant-apply actions.
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
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="type-title text-xl">Goals</h2>
				<div className="flex flex-wrap items-center gap-2">
					{EVALUATION_TYPE_ORDER.map((type) => (
						<Button
							key={type}
							type="button"
							size="sm"
							variant="secondary"
							onClick={() => handleAdd(type)}
						>
							+ {evaluationUiRegistry[type].label}
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
						<h3 className="px-1 type-eyebrow">{definition.label}</h3>
						{table.length === 0 ? (
							<EmptyState>
								<p>None.</p>
							</EmptyState>
						) : (
							table.map((evaluation, index) => {
								const config = validatedConfig(type, evaluation.config);
								const dirtyKey = `${type}:${evaluation.instanceId}`;
								const isDirty = dirtyKeys.has(dirtyKey);
								const isRecalculating = recalcKeys.has(dirtyKey);
								return (
									<GoalCard
										key={evaluation.instanceId}
										type={type}
										evaluation={evaluation}
										index={index}
										tableLength={table.length}
										document={document}
										dataUpdatedAt={dataUpdatedAt}
										configError={config.error}
										configNormalized={config.normalized}
										ConfigEditor={ConfigEditor}
										isDirty={isDirty}
										isRecalculating={isRecalculating}
										notifyDirty={notifyDirty}
										flashRecalculating={flashRecalculating}
										onRemove={() => {
											notifyDirty(dirtyKey, false);
											removeEvaluation(type, evaluation.instanceId);
										}}
										updateEvaluation={updateEvaluation}
										updateEvaluationConfig={updateEvaluationConfig}
										duplicateEvaluation={duplicateEvaluation}
										moveEvaluation={moveEvaluation}
									/>
								);
							})
						)}
					</div>
				);
			})}
		</section>
	);
}

function GoalCard({
	type,
	evaluation,
	index,
	tableLength,
	document,
	dataUpdatedAt,
	configError,
	configNormalized,
	ConfigEditor,
	isDirty,
	isRecalculating,
	notifyDirty,
	flashRecalculating,
	onRemove,
	updateEvaluation,
	updateEvaluationConfig,
	duplicateEvaluation,
	moveEvaluation,
}: {
	type: EvaluationType;
	evaluation: EvaluationInstance<unknown>;
	index: number;
	tableLength: number;
	document: FinancialModelDocument;
	dataUpdatedAt: number;
	configError: string | null;
	configNormalized: unknown;
	ConfigEditor: ComponentType<ConfigEditorProps> | undefined;
	isDirty: boolean;
	isRecalculating: boolean;
	notifyDirty: (key: string, dirty: boolean) => void;
	flashRecalculating: (key: string) => void;
	onRemove: () => void;
	updateEvaluation: (
		type: EvaluationType,
		instanceId: string,
		changes: Partial<EvaluationInstance<unknown>>,
	) => void;
	updateEvaluationConfig: (
		type: EvaluationType,
		instanceId: string,
		changes: object,
	) => void;
	duplicateEvaluation: (type: EvaluationType, instanceId: string) => void;
	moveEvaluation: (
		type: EvaluationType,
		instanceId: string,
		delta: -1 | 1,
	) => void;
}) {
	const dirtyKey = `${type}:${evaluation.instanceId}`;
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
						<div className="min-w-0 flex-1">
							<input
								type="text"
								value={evaluation.label}
								title={evaluation.instanceId}
								aria-label="Goal name"
								onChange={(event) => {
									updateEvaluation(type, evaluation.instanceId, {
										label: event.target.value,
									});
									flashRecalculating(dirtyKey);
								}}
								className="w-full bg-transparent type-title text-xl outline-none focus:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
							/>
							<div className="mt-1 flex flex-wrap items-center gap-2">
								{isRecalculating ? (
									<Pill tone="primary" size="xs">
										<span role="status">…</span>
									</Pill>
								) : null}
								{isDirty ? (
									<Pill tone="tertiary" size="xs">
										Unsaved
									</Pill>
								) : null}
								{evaluation.enabled ? null : <Pill size="xs">Off</Pill>}
							</div>
						</div>
					</div>
					<div className="flex flex-wrap gap-1">
						<Button
							type="button"
							size="sm"
							variant="ghost"
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
							onClick={() => {
								moveEvaluation(type, evaluation.instanceId, 1);
								flashRecalculating(dirtyKey);
							}}
							disabled={index === tableLength - 1}
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
						<Button type="button" size="sm" variant="ghost" onClick={onRemove}>
							Remove
						</Button>
					</div>
				</div>
			}
			contentClassName="space-y-4 p-4 md:p-6"
		>
			{configError ? (
				<p
					role="alert"
					className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 type-caption text-destructive"
				>
					{configError}
				</p>
			) : null}
			{ConfigEditor && configNormalized !== null ? (
				<div className="max-w-sm">
					<ConfigEditor
						evaluation={{
							...evaluation,
							config: configNormalized,
						}}
						onChange={(changes) => {
							updateEvaluationConfig(type, evaluation.instanceId, changes);
							notifyDirty(dirtyKey, false);
							flashRecalculating(dirtyKey);
						}}
						onDirtyChange={(dirty) => notifyDirty(dirtyKey, dirty)}
					/>
				</div>
			) : null}
			{type === "financialIndependence" && configNormalized !== null ? (
				<FinancialIndependencePlanEditor
					document={document}
					plan={configNormalized as unknown as FinancialIndependencePlan}
					sourceRevision={dataUpdatedAt}
					onApply={(changes) => {
						updateEvaluationConfig(type, evaluation.instanceId, changes);
						notifyDirty(dirtyKey, false);
						flashRecalculating(dirtyKey);
					}}
					onDirtyChange={(dirty) => notifyDirty(dirtyKey, dirty)}
				/>
			) : null}
		</SectionCard>
	);
}
