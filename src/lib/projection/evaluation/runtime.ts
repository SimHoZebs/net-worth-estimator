import type {
	ConfiguredEvaluation,
	EvaluationDiagnostic,
	EvaluationResultCollection,
	EvaluationResultEnvelope,
	EvaluationResultStatus,
	JsonValue,
	ProjectionPath,
	ScenarioPack,
} from "../types/scenario";
import { isJsonValue } from "./json";

export interface EvaluationContext {
	path: ProjectionPath;
	scenario: ScenarioPack;
	stochasticRates?: ReadonlyMap<string, readonly number[]>;
}

export interface EvaluationFinalizeContext {
	scenario: ScenarioPack;
	deterministicPath: ProjectionPath;
	runCount: number;
}

export interface EvaluationDefinition<
	TConfig = unknown,
	TPathResult = unknown,
	TAccumulator = unknown,
	TProbabilisticResult = unknown,
> {
	id: string;
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
	private readonly definitions = new Map<string, RuntimeDefinition>();

	constructor(definitions: readonly EvaluationDefinition[] = []) {
		for (const definition of definitions) this.register(definition);
	}

	register(definition: EvaluationDefinition): void {
		if (this.definitions.has(definition.id)) {
			throw new Error(
				`Evaluation definition "${definition.id}" is already registered.`,
			);
		}
		this.definitions.set(definition.id, definition as RuntimeDefinition);
	}

	get(id: string): RuntimeDefinition | undefined {
		return this.definitions.get(id);
	}

	list(): Array<{ id: string; label: string }> {
		return [...this.definitions.values()].map(({ id, label }) => ({
			id,
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
	private readonly diagnostics: EvaluationDiagnostic[];

	constructor(
		private readonly configured: ConfiguredEvaluation,
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
			definitionId: this.configured.definitionId,
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

export class EvaluationRuntimeSet {
	private readonly runtimes: EvaluationInstanceRuntime[];
	readonly evaluationOrder: string[];

	constructor(
		configured: readonly ConfiguredEvaluation[],
		registry: EvaluationRegistry,
	) {
		const idCounts = new Map<string, number>();
		for (const item of configured) {
			idCounts.set(item.instanceId, (idCounts.get(item.instanceId) ?? 0) + 1);
		}

		const seenIds = new Set<string>();
		this.runtimes = configured.flatMap((item) => {
			if (seenIds.has(item.instanceId)) return [];
			seenIds.add(item.instanceId);
			const diagnostics: EvaluationDiagnostic[] = [];
			if (!item.instanceId.trim() || (idCounts.get(item.instanceId) ?? 0) > 1) {
				diagnostics.push({
					code: "duplicate-evaluation-instance-id",
					severity: "error",
					message: item.instanceId.trim()
						? `Evaluation instance ID "${item.instanceId}" is duplicated.`
						: "Evaluation instance ID is required.",
				});
				return [new EvaluationInstanceRuntime(item, null, diagnostics)];
			}
			if (!item.enabled) {
				diagnostics.push({
					code: "evaluation-disabled",
					severity: "info",
					message: "Evaluation is disabled.",
				});
				return [new EvaluationInstanceRuntime(item, null, diagnostics)];
			}
			const definition = registry.get(item.definitionId);
			if (!definition) {
				diagnostics.push({
					code: "unknown-evaluation-definition",
					severity: "error",
					message: `Unknown evaluation definition "${item.definitionId}".`,
				});
				return [new EvaluationInstanceRuntime(item, null, diagnostics)];
			}
			try {
				const config = definition.validateConfig(item.config);
				if (!isJsonValue(config)) {
					throw new Error("Evaluation config must be JSON-serializable.");
				}
				return [new EvaluationInstanceRuntime({ ...item, config }, definition)];
			} catch (error) {
				diagnostics.push(errorDiagnostic("invalid-evaluation-config", error));
				return [new EvaluationInstanceRuntime(item, null, diagnostics)];
			}
		});
		this.evaluationOrder = this.runtimes.map((runtime) => runtime.instanceId);
	}

	evaluateDeterministic(context: EvaluationContext): void {
		for (const runtime of this.runtimes) runtime.evaluateDeterministic(context);
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

	result(): EvaluationResultCollection {
		const evaluations: Record<string, EvaluationResultEnvelope> = {};
		for (const runtime of this.runtimes) {
			const envelope = runtime.envelope();
			evaluations[envelope.instanceId] = envelope;
		}
		return { evaluationOrder: [...this.evaluationOrder], evaluations };
	}
}
