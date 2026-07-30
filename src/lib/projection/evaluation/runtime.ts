import type {
	EvaluationDiagnostic,
	EvaluationInstance,
	EvaluationResultCollection,
	EvaluationResultEnvelope,
	EvaluationResultStatus,
	EvaluationTables,
	EvaluationType,
	FinancialModelDocument,
	JsonValue,
	ProjectionPath,
} from "../types/model";
import { EVALUATION_TYPE_ORDER } from "../types/model";
import type { MonteCarloSample } from "../types/simulation";
import type { StochasticEvaluationWorkload } from "../types/stochastic";
import { isJsonValue } from "./json";

export interface EvaluationContext {
	path: ProjectionPath;
	document: FinancialModelDocument;
	monteCarloSample?: MonteCarloSample;
	detailLevel?: "detailed" | "summary";
}

export interface EvaluationFinalizeContext {
	document: FinancialModelDocument;
	deterministicPath: ProjectionPath;
	runCount: number;
}

export interface EvaluationWorkloadPlan {
	unitsPerRun: number;
	unitLabel: string;
	unitAction: string;
	intensiveUnitLabel?: string;
	intensiveUnitAction?: string;
	description?: string;
}

export interface EvaluationWorkloadMeasurement {
	intensiveUnitsCompleted?: number;
}

export interface EvaluationDefinition<
	TConfig = unknown,
	TPathResult = unknown,
	TAccumulator = unknown,
	TProbabilisticResult = unknown,
> {
	type: EvaluationType;
	label: string;
	validateConfig(config: unknown): TConfig;
	evaluatePath(context: EvaluationContext, config: TConfig): TPathResult;
	createAccumulator(
		config: TConfig,
		deterministicResult: TPathResult,
	): TAccumulator;
	accumulate(accumulator: TAccumulator, pathResult: TPathResult): void;
	finalize(
		accumulator: TAccumulator,
		context: EvaluationFinalizeContext,
	): TProbabilisticResult;
	status(
		deterministic: TPathResult | null,
		probabilistic: TProbabilisticResult | null,
	): EvaluationResultStatus;
	describeStochasticWork?(
		context: EvaluationContext,
		config: TConfig,
	): EvaluationWorkloadPlan | null;
	measureStochasticWork?(
		accumulator: TAccumulator,
	): EvaluationWorkloadMeasurement | null;
	diagnoseConfig?(
		context: EvaluationContext,
		config: TConfig,
	): EvaluationDiagnostic[];
}

type RuntimeDefinition = EvaluationDefinition<
	unknown,
	unknown,
	unknown,
	unknown
>;

export class EvaluationRegistry {
	private readonly definitions = new Map<EvaluationType, RuntimeDefinition>();

	constructor(definitions: readonly EvaluationDefinition[] = []) {
		for (const definition of definitions) this.register(definition);
	}

	register(definition: EvaluationDefinition): void {
		if (this.definitions.has(definition.type)) {
			throw new Error(
				`Evaluation definition "${definition.type}" is already registered.`,
			);
		}
		this.definitions.set(definition.type, definition as RuntimeDefinition);
	}

	get(type: EvaluationType): RuntimeDefinition | undefined {
		return this.definitions.get(type);
	}

	list(): Array<{ type: EvaluationType; label: string }> {
		return [...this.definitions.values()].map(({ type, label }) => ({
			type,
			label,
		}));
	}
}

function errorDiagnostic(code: string, error: unknown): EvaluationDiagnostic {
	return {
		code,
		severity: "error",
		message: error instanceof Error ? error.message : String(error),
	};
}

class EvaluationInstanceRuntime {
	private deterministic: JsonValue | null = null;
	private probabilistic: JsonValue | null = null;
	private accumulator: unknown = null;
	private stochasticFailed = false;
	private workloadPlan: EvaluationWorkloadPlan | null = null;
	private readonly diagnostics: EvaluationDiagnostic[];

	constructor(
		readonly type: EvaluationType,
		private readonly configured: EvaluationInstance<unknown>,
		private readonly definition: RuntimeDefinition | null,
		diagnostics: EvaluationDiagnostic[] = [],
	) {
		this.diagnostics = diagnostics;
	}

	get instanceId(): string {
		return this.configured.instanceId;
	}

	evaluateDeterministic(context: EvaluationContext): void {
		if (
			!this.definition ||
			this.diagnostics.some((item) => item.severity === "error")
		)
			return;
		try {
			this.diagnostics.push(
				...(this.definition.diagnoseConfig?.(context, this.configured.config) ??
					[]),
			);
			const result = this.definition.evaluatePath(
				context,
				this.configured.config,
			);
			if (!isJsonValue(result)) {
				throw new Error("Evaluation result must be JSON-serializable.");
			}
			this.deterministic = result;
		} catch (error) {
			this.diagnostics.push(errorDiagnostic("evaluation-runtime-error", error));
		}
	}

	prepareStochasticWork(context: EvaluationContext): void {
		if (!this.definition || this.hasErrors()) return;
		try {
			const plan = this.definition.describeStochasticWork?.(
				context,
				this.configured.config,
			);
			this.workloadPlan = isEvaluationWorkloadPlan(plan) ? plan : null;
		} catch {
			this.workloadPlan = null;
		}
	}

	startStochastic(): void {
		if (!this.definition || this.deterministic === null || this.hasErrors())
			return;
		try {
			this.accumulator = this.definition.createAccumulator(
				this.configured.config,
				this.deterministic,
			);
		} catch (error) {
			this.stochasticFailed = true;
			this.diagnostics.push(
				errorDiagnostic("evaluation-accumulator-error", error),
			);
		}
	}

	consume(context: EvaluationContext): void {
		if (!this.definition || this.accumulator === null || this.stochasticFailed)
			return;
		try {
			const pathResult = this.definition.evaluatePath(
				context,
				this.configured.config,
			);
			this.definition.accumulate(this.accumulator, pathResult);
		} catch (error) {
			this.stochasticFailed = true;
			this.probabilistic = null;
			this.diagnostics.push(errorDiagnostic("evaluation-runtime-error", error));
		}
	}

	finalize(context: EvaluationFinalizeContext): void {
		if (!this.definition || this.accumulator === null || this.stochasticFailed)
			return;
		try {
			const result = this.definition.finalize(this.accumulator, context);
			if (!isJsonValue(result)) {
				throw new Error("Evaluation result must be JSON-serializable.");
			}
			this.probabilistic = result;
		} catch (error) {
			this.stochasticFailed = true;
			this.probabilistic = null;
			this.diagnostics.push(
				errorDiagnostic("evaluation-finalize-error", error),
			);
		}
	}

	workloadProgress(
		completedRuns: number,
		totalRuns: number,
	): StochasticEvaluationWorkload | null {
		if (this.workloadPlan === null) return null;
		let measurement: EvaluationWorkloadMeasurement | null = null;
		if (this.accumulator !== null && !this.stochasticFailed) {
			try {
				const candidate = this.definition?.measureStochasticWork?.(
					this.accumulator,
				);
				if (isEvaluationWorkloadMeasurement(candidate)) measurement = candidate;
			} catch {
				measurement = null;
			}
		}
		return {
			type: this.type,
			instanceId: this.instanceId,
			label: this.configured.label,
			completedUnits: completedRuns * this.workloadPlan.unitsPerRun,
			totalUnits: totalRuns * this.workloadPlan.unitsPerRun,
			unitLabel: this.workloadPlan.unitLabel,
			unitAction: this.workloadPlan.unitAction,
			...(this.workloadPlan.intensiveUnitLabel
				? { intensiveUnitLabel: this.workloadPlan.intensiveUnitLabel }
				: {}),
			...(this.workloadPlan.intensiveUnitAction
				? { intensiveUnitAction: this.workloadPlan.intensiveUnitAction }
				: {}),
			...(measurement?.intensiveUnitsCompleted !== undefined
				? {
						intensiveUnitsCompleted: measurement.intensiveUnitsCompleted,
					}
				: {}),
			...(this.workloadPlan.description
				? { description: this.workloadPlan.description }
				: {}),
		};
	}

	envelope(): EvaluationResultEnvelope {
		let status: EvaluationResultStatus = "indeterminate";
		if (this.hasErrors()) {
			status = "warning";
		} else if (this.definition) {
			try {
				status = this.definition.status(this.deterministic, this.probabilistic);
			} catch (error) {
				this.diagnostics.push(
					errorDiagnostic("evaluation-status-error", error),
				);
				status = "warning";
			}
		}
		return {
			instanceId: this.configured.instanceId,
			label: this.configured.label,
			status,
			deterministic: this.deterministic,
			probabilistic: this.probabilistic,
			diagnostics: [...this.diagnostics],
		};
	}

	private hasErrors(): boolean {
		return this.diagnostics.some((item) => item.severity === "error");
	}
}

function isNonNegativeFinite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isEvaluationWorkloadPlan(
	value: EvaluationWorkloadPlan | null | undefined,
): value is EvaluationWorkloadPlan {
	return Boolean(
		value &&
			isNonNegativeFinite(value.unitsPerRun) &&
			Number.isInteger(value.unitsPerRun) &&
			typeof value.unitLabel === "string" &&
			value.unitLabel.trim() &&
			typeof value.unitAction === "string" &&
			value.unitAction.trim() &&
			(value.intensiveUnitLabel === undefined ||
				typeof value.intensiveUnitLabel === "string") &&
			(value.intensiveUnitAction === undefined ||
				typeof value.intensiveUnitAction === "string") &&
			(value.description === undefined ||
				typeof value.description === "string") &&
			isJsonValue(value),
	);
}

function isEvaluationWorkloadMeasurement(
	value: EvaluationWorkloadMeasurement | null | undefined,
): value is EvaluationWorkloadMeasurement {
	return Boolean(
		value &&
			(value.intensiveUnitsCompleted === undefined ||
				(isNonNegativeFinite(value.intensiveUnitsCompleted) &&
					Number.isInteger(value.intensiveUnitsCompleted))) &&
			isJsonValue(value),
	);
}

export class EvaluationRuntimeSet {
	private readonly runtimes: EvaluationInstanceRuntime[];

	constructor(configured: EvaluationTables, registry: EvaluationRegistry) {
		const idCounts = new Map<string, number>();
		for (const type of EVALUATION_TYPE_ORDER) {
			for (const item of configured[type]) {
				idCounts.set(item.instanceId, (idCounts.get(item.instanceId) ?? 0) + 1);
			}
		}

		const seenIds = new Set<string>();
		this.runtimes = [];
		for (const type of EVALUATION_TYPE_ORDER) {
			for (const item of configured[type]) {
				if (seenIds.has(item.instanceId)) continue;
				seenIds.add(item.instanceId);
				const diagnostics: EvaluationDiagnostic[] = [];
				if (
					!item.instanceId.trim() ||
					(idCounts.get(item.instanceId) ?? 0) > 1
				) {
					diagnostics.push({
						code: "duplicate-evaluation-instance-id",
						severity: "error",
						message: item.instanceId.trim()
							? `Evaluation instance ID "${item.instanceId}" is duplicated.`
							: "Evaluation instance ID is required.",
					});
					this.runtimes.push(
						new EvaluationInstanceRuntime(type, item, null, diagnostics),
					);
					continue;
				}
				if (!item.enabled) {
					diagnostics.push({
						code: "evaluation-disabled",
						severity: "info",
						message: "Evaluation is disabled.",
					});
					this.runtimes.push(
						new EvaluationInstanceRuntime(type, item, null, diagnostics),
					);
					continue;
				}
				const definition = registry.get(type);
				if (!definition) {
					diagnostics.push({
						code: "unknown-evaluation-definition",
						severity: "error",
						message: `No evaluator is registered for "${type}".`,
					});
					this.runtimes.push(
						new EvaluationInstanceRuntime(type, item, null, diagnostics),
					);
					continue;
				}
				try {
					const config = definition.validateConfig(item.config);
					if (!isJsonValue(config)) {
						throw new Error("Evaluation config must be JSON-serializable.");
					}
					this.runtimes.push(
						new EvaluationInstanceRuntime(
							type,
							{ ...item, config },
							definition,
						),
					);
				} catch (error) {
					diagnostics.push(errorDiagnostic("invalid-evaluation-config", error));
					this.runtimes.push(
						new EvaluationInstanceRuntime(type, item, null, diagnostics),
					);
				}
			}
		}
	}

	evaluateDeterministic(context: EvaluationContext): void {
		for (const runtime of this.runtimes) runtime.evaluateDeterministic(context);
	}

	prepareStochasticWork(context: EvaluationContext): void {
		for (const runtime of this.runtimes) {
			runtime.prepareStochasticWork(context);
		}
	}

	startStochastic(): void {
		for (const runtime of this.runtimes) runtime.startStochastic();
	}

	consume(context: EvaluationContext): void {
		for (const runtime of this.runtimes) runtime.consume(context);
	}

	finalize(context: EvaluationFinalizeContext): void {
		for (const runtime of this.runtimes) runtime.finalize(context);
	}

	workloadProgress(
		completedRuns: number,
		totalRuns: number,
	): StochasticEvaluationWorkload[] {
		return this.runtimes.flatMap((runtime) => {
			const progress = runtime.workloadProgress(completedRuns, totalRuns);
			return progress === null ? [] : [progress];
		});
	}

	result(): EvaluationResultCollection {
		const evaluations: EvaluationResultCollection["evaluations"] = {
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
		};
		for (const runtime of this.runtimes) {
			evaluations[runtime.type].push(runtime.envelope());
		}
		return { evaluations };
	}
}
