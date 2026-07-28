import type {
	EvaluationResultCollection,
	FinancialModelDocument,
	ProjectionResult,
	RawProjectionOutput,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";
import { applyModelOverrides } from "@/lib/projection";
import {
	canonicalSerialize,
	type ProjectionArtifactEnvelope,
	type ProjectionArtifactStore,
	sha256Hex,
} from "@/lib/projection/artifacts";
import {
	evaluationComputationDescriptor,
	projectionComputationSettings,
	simulationDocument,
} from "@/lib/projection/runtime/computationIdentity";
import type {
	ProgressCallback,
	ProjectionComputationEngine,
	ProjectionEngine,
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";
import {
	labelProjectionResult,
	labelStochasticResult,
} from "@/lib/projection/runtime/resultLabels";
import { normalizeStochasticConfig } from "@/lib/projection/utils/stochastic";

const ARTIFACT_SCHEMA_VERSION = 1;
const DETERMINISTIC_BASE_VERSION = "deterministic-base-v2";
const DETERMINISTIC_EVALUATION_VERSION = "deterministic-evaluation-v2";
const STOCHASTIC_VERSION = "stochastic-v2";

type ArtifactPayload =
	| RawProjectionOutput
	| EvaluationResultCollection
	| StochasticProjectionResult;

interface ArtifactIdentity {
	kind: string;
	algorithmVersion: string;
	digest: string;
	key: string;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvaluationResultCollection(
	value: unknown,
): value is EvaluationResultCollection {
	if (!isRecord(value) || !isRecord(value.evaluations)) return false;
	return (
		Array.isArray(value.evaluations.financialIndependence) &&
		Array.isArray(value.evaluations.netWorthThreshold) &&
		Array.isArray(value.evaluations.postingFulfillment)
	);
}

function isProjectionCoreResult(value: unknown): boolean {
	return (
		isRecord(value) &&
		isRecord(value.timeline) &&
		Array.isArray(value.timeline.rows) &&
		Array.isArray(value.timeline.sampledRows) &&
		Array.isArray(value.accountSummaries) &&
		isRecord(value.totals) &&
		isRecord(value.milestones) &&
		isRecord(value.summary)
	);
}

function isProjectionResult(value: unknown): value is ProjectionResult {
	return isProjectionCoreResult(value) && isEvaluationResultCollection(value);
}

function isFinancialModelDocument(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.sourcePath === "string" &&
		Array.isArray(value.accounts) &&
		Array.isArray(value.checkpoints) &&
		Array.isArray(value.postings) &&
		isRecord(value.evaluations)
	);
}

function isRawProjectionOutput(value: unknown): value is RawProjectionOutput {
	return (
		isRecord(value) &&
		isRecord(value.path) &&
		Array.isArray(value.path.rows) &&
		Array.isArray(value.path.movementEvents) &&
		isFinancialModelDocument(value.path.effectiveDocument) &&
		typeof value.path.projectionStartDate === "string" &&
		typeof value.path.projectionEndDate === "string" &&
		isProjectionCoreResult(value.result)
	);
}

function isStochasticProjectionResult(
	value: unknown,
): value is StochasticProjectionResult {
	return (
		isRecord(value) &&
		isRecord(value.config) &&
		typeof value.config.runCount === "number" &&
		(value.config.seed === null || typeof value.config.seed === "number") &&
		isProjectionResult(value.deterministic) &&
		Array.isArray(value.bands) &&
		isRecord(value.milestones) &&
		isEvaluationResultCollection(value)
	);
}

function baseDescriptor(request: ProjectionRequest) {
	const effectiveDocument = applyModelOverrides(
		request.document,
		request.overrides,
	);
	return {
		effectiveDocument,
		descriptor: {
			document: simulationDocument(effectiveDocument),
			fallbackProjectionStartDate:
				request.projectionSettings.fallbackProjectionStartDate,
			horizonYears: request.projectionSettings.horizonYears,
		},
	};
}

function withEffectiveDocument(
	raw: RawProjectionOutput,
	effectiveDocument: FinancialModelDocument,
): RawProjectionOutput {
	return {
		result: structuredClone(raw.result),
		path: {
			...structuredClone(raw.path),
			effectiveDocument: structuredClone(effectiveDocument),
		},
	};
}

function createConcreteSeed(): number {
	const values = new Uint32Array(1);
	globalThis.crypto.getRandomValues(values);
	return values[0]! & 0x7fffffff;
}

export class CachedProjectionEngine implements ProjectionEngine {
	constructor(
		private readonly compute: ProjectionComputationEngine,
		private readonly store: ProjectionArtifactStore,
	) {}

	async project(request: ProjectionRequest): Promise<ProjectionResult> {
		throwIfAborted(request.signal);
		const settings = projectionComputationSettings(request.projectionSettings);
		let prepared: ReturnType<typeof baseDescriptor>;
		let baseIdentity: ArtifactIdentity;
		try {
			prepared = baseDescriptor({ ...request, projectionSettings: settings });
			baseIdentity = await this.identity(
				"deterministic-base",
				DETERMINISTIC_BASE_VERSION,
				prepared.descriptor,
			);
		} catch {
			throwIfAborted(request.signal);
			return this.compute.project(request);
		}
		throwIfAborted(request.signal);

		let raw = await this.read(
			baseIdentity,
			isRawProjectionOutput,
			request.signal,
		);
		if (!raw) {
			raw = await this.compute.projectBase({
				...request,
				projectionSettings: settings,
			});
			raw = await this.publish(baseIdentity, raw, isRawProjectionOutput);
		}
		raw = withEffectiveDocument(raw, prepared.effectiveDocument);

		let evaluationIdentity: ArtifactIdentity;
		try {
			evaluationIdentity = await this.identity(
				"deterministic-evaluation",
				DETERMINISTIC_EVALUATION_VERSION,
				{
					baseDigest: baseIdentity.digest,
					evaluations: evaluationComputationDescriptor(settings.evaluations),
				},
			);
		} catch {
			throwIfAborted(request.signal);
			const evaluations = await this.compute.evaluateProjection({
				path: raw.path,
				evaluations: settings.evaluations,
				signal: request.signal,
			});
			return labelProjectionResult(
				{ ...raw.result, ...evaluations },
				request.projectionSettings.evaluations,
			);
		}

		let evaluations = await this.read(
			evaluationIdentity,
			isEvaluationResultCollection,
			request.signal,
		);
		if (!evaluations) {
			evaluations = await this.compute.evaluateProjection({
				path: raw.path,
				evaluations: settings.evaluations,
				signal: request.signal,
			});
			evaluations = await this.publish(
				evaluationIdentity,
				evaluations,
				isEvaluationResultCollection,
			);
		}
		throwIfAborted(request.signal);
		return labelProjectionResult(
			{ ...raw.result, ...evaluations },
			request.projectionSettings.evaluations,
		);
	}

	async projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult> {
		throwIfAborted(request.signal);
		const settings = projectionComputationSettings(request.projectionSettings);
		const logicalConfig = normalizeStochasticConfig(request.config);
		let identity: ArtifactIdentity;
		try {
			const prepared = baseDescriptor({
				...request,
				projectionSettings: settings,
			});
			identity = await this.identity("stochastic", STOCHASTIC_VERSION, {
				base: prepared.descriptor,
				evaluations: evaluationComputationDescriptor(settings.evaluations),
				config: logicalConfig,
			});
		} catch {
			throwIfAborted(request.signal);
			return this.compute.projectStochastic(request, onProgress);
		}

		const cached = await this.read(
			identity,
			isStochasticProjectionResult,
			request.signal,
		);
		if (cached) {
			return labelStochasticResult(
				cached,
				request.projectionSettings.evaluations,
			);
		}

		let concreteConfig: StochasticConfig;
		try {
			concreteConfig = {
				...logicalConfig,
				seed: logicalConfig.seed ?? createConcreteSeed(),
			};
		} catch {
			concreteConfig = logicalConfig;
		}
		const computed = await this.compute.projectStochastic(
			{
				...request,
				projectionSettings: settings,
				config: concreteConfig,
			},
			onProgress,
		);
		throwIfAborted(request.signal);
		const winner = await this.publish(
			identity,
			computed,
			isStochasticProjectionResult,
		);
		throwIfAborted(request.signal);
		return labelStochasticResult(
			winner,
			request.projectionSettings.evaluations,
		);
	}

	private async identity(
		kind: string,
		algorithmVersion: string,
		descriptor: unknown,
	): Promise<ArtifactIdentity> {
		const digest = await sha256Hex(
			canonicalSerialize({
				schemaVersion: ARTIFACT_SCHEMA_VERSION,
				algorithmVersion,
				descriptor,
			}),
		);
		return {
			kind,
			algorithmVersion,
			digest,
			key: `${kind}:${ARTIFACT_SCHEMA_VERSION}:${algorithmVersion}:${digest}`,
		};
	}

	private async read<T extends ArtifactPayload>(
		identity: ArtifactIdentity,
		isPayload: (value: unknown) => value is T,
		signal: AbortSignal | undefined,
	): Promise<T | undefined> {
		try {
			const envelope = await this.store.get(identity.key);
			throwIfAborted(signal);
			if (!envelope) return undefined;
			if (
				envelope.kind !== identity.kind ||
				envelope.schemaVersion !== ARTIFACT_SCHEMA_VERSION ||
				envelope.algorithmVersion !== identity.algorithmVersion ||
				envelope.inputDigest !== identity.digest ||
				!isPayload(envelope.payload)
			) {
				await this.store.delete(identity.key).catch(() => undefined);
				return undefined;
			}
			return structuredClone(envelope.payload);
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				throw error;
			return undefined;
		}
	}

	private async publish<T extends ArtifactPayload>(
		identity: ArtifactIdentity,
		payload: T,
		isPayload: (value: unknown) => value is T,
	): Promise<T> {
		const envelope: ProjectionArtifactEnvelope<ArtifactPayload> = {
			kind: identity.kind,
			schemaVersion: ARTIFACT_SCHEMA_VERSION,
			algorithmVersion: identity.algorithmVersion,
			inputDigest: identity.digest,
			createdAt: new Date().toISOString(),
			payload,
		};
		try {
			const winner = await this.store.putIfAbsent(identity.key, envelope);
			if (
				winner.kind === identity.kind &&
				winner.schemaVersion === ARTIFACT_SCHEMA_VERSION &&
				winner.algorithmVersion === identity.algorithmVersion &&
				winner.inputDigest === identity.digest &&
				isPayload(winner.payload)
			) {
				return structuredClone(winner.payload);
			}
		} catch {
			// Derived artifacts are best-effort; computation remains authoritative.
		}
		return structuredClone(payload);
	}
}
