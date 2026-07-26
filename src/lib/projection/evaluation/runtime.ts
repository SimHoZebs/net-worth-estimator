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
