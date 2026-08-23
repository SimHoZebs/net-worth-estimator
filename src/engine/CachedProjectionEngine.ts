import type {
	ProjectionResult,
	StochasticConfig,
	StochasticProjectionResult,
} from "@/lib/projection";
import { applyModelOverrides } from "@/lib/projection";
import {
	canonicalSerialize,
	type ProjectionArtifactEnvelope,
	type ProjectionArtifactStore,
	projectionCacheErrorDetails,
	sha256Hex,
	traceProjectionCache,
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

// Bump when projection algorithms or persisted payload semantics change.

const ARTIFACT_CACHE_VERSION = 2;

type ArtifactPayload = ProjectionResult | StochasticProjectionResult;

interface ArtifactIdentity {
	kind: string;
	digest: string;
	key: string;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

// Structural guards for self-produced cache payloads. The in-memory store only
// ever holds values this engine published, so light checks suffice.

function isProjectionResult(value: unknown): value is ProjectionResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"timeline" in value &&
		"evaluations" in value &&
		"summary" in value
	);
}

function isStochasticProjectionResult(
	value: unknown,
): value is StochasticProjectionResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"deterministic" in value &&
		"bands" in value &&
		"config" in value
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
			incomeData: request.incomeData ?? null,
			fallbackProjectionStartDate:
				request.projectionSettings.fallbackProjectionStartDate,
			horizonYears: request.projectionSettings.horizonYears,
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
		let identity: ArtifactIdentity;
		try {
			const prepared = baseDescriptor({
				...request,
				projectionSettings: settings,
			});
			identity = await this.identity("deterministic", {
				base: prepared.descriptor,
				evaluations: evaluationComputationDescriptor(settings.evaluations),
			});
		} catch (error) {
			traceProjectionCache("cache.identity.error", {
				kind: "deterministic",
				...projectionCacheErrorDetails(error),
			});
			throwIfAborted(request.signal);
			return this.compute.project(request);
		}
		throwIfAborted(request.signal);

		const cached = await this.read(
			identity,
			isProjectionResult,
			request.signal,
		);
		if (cached) {
			traceProjectionCache("cache.hit", {
				kind: identity.kind,
				key: identity.key,
			});
			return labelProjectionResult(
				cached,
				request.projectionSettings.evaluations,
			);
		}

		traceProjectionCache("compute.start", {
			kind: identity.kind,
			key: identity.key,
		});
		let computed: ProjectionResult;
		try {
			computed = await this.compute.project({
				...request,
				projectionSettings: settings,
			});
		} catch (error) {
			traceProjectionCache("compute.error", {
				kind: identity.kind,
				key: identity.key,
				...projectionCacheErrorDetails(error),
			});
			throw error;
		}
		traceProjectionCache("compute.complete", {
			kind: identity.kind,
			key: identity.key,
		});
		const winner = await this.publish(identity, computed, isProjectionResult);
		throwIfAborted(request.signal);
		return labelProjectionResult(
			winner,
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
			identity = await this.identity("stochastic", {
				base: prepared.descriptor,
				evaluations: evaluationComputationDescriptor(settings.evaluations),
				config: logicalConfig,
			});
		} catch (error) {
			traceProjectionCache("cache.identity.error", {
				kind: "stochastic",
				...projectionCacheErrorDetails(error),
			});
			throwIfAborted(request.signal);
			return this.compute.projectStochastic(request, onProgress);
		}

		const cached = await this.read(
			identity,
			isStochasticProjectionResult,
			request.signal,
		);
		if (cached) {
			traceProjectionCache("stochastic.cache-hit", {
				kind: identity.kind,
				key: identity.key,
			});
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
		traceProjectionCache("compute.start", {
			kind: identity.kind,
			key: identity.key,
		});
		let computed: StochasticProjectionResult;
		try {
			computed = await this.compute.projectStochastic(
				{
					...request,
					projectionSettings: settings,
					config: concreteConfig,
				},
				onProgress,
			);
		} catch (error) {
			traceProjectionCache("compute.error", {
				kind: identity.kind,
				key: identity.key,
				...projectionCacheErrorDetails(error),
			});
			throw error;
		}
		traceProjectionCache("compute.complete", {
			kind: identity.kind,
			key: identity.key,
		});
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
		descriptor: unknown,
	): Promise<ArtifactIdentity> {
		const digest = await sha256Hex(
			canonicalSerialize({
				artifactCacheVersion: ARTIFACT_CACHE_VERSION,
				descriptor,
			}),
		);
		const identity = {
			kind,
			digest,
			key: `${kind}:${ARTIFACT_CACHE_VERSION}:${digest}`,
		};
		traceProjectionCache("cache.identity", identity);
		return identity;
	}

	private async read<T extends ArtifactPayload>(
		identity: ArtifactIdentity,
		isPayload: (value: unknown) => value is T,
		signal: AbortSignal | undefined,
	): Promise<T | undefined> {
		try {
			const envelope = await this.store.get(identity.key);
			throwIfAborted(signal);
			if (!envelope) {
				traceProjectionCache("cache.read", {
					kind: identity.kind,
					key: identity.key,
					outcome: "miss",
				});
				return undefined;
			}
			if (
				envelope.kind !== identity.kind ||
				envelope.inputDigest !== identity.digest ||
				!isPayload(envelope.payload)
			) {
				traceProjectionCache("cache.read", {
					kind: identity.kind,
					key: identity.key,
					outcome: "invalid",
				});
				await this.store.delete(identity.key).catch(() => undefined);
				return undefined;
			}
			traceProjectionCache("cache.read", {
				kind: identity.kind,
				key: identity.key,
				outcome: "hit",
			});
			return structuredClone(envelope.payload);
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError")
				throw error;
			traceProjectionCache("cache.read", {
				kind: identity.kind,
				key: identity.key,
				outcome: "error",
				...projectionCacheErrorDetails(error),
			});
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
			inputDigest: identity.digest,
			createdAt: new Date().toISOString(),
			payload,
		};
		traceProjectionCache("cache.publish.start", {
			kind: identity.kind,
			key: identity.key,
		});
		try {
			const winner = await this.store.putIfAbsent(identity.key, envelope);
			if (
				winner.kind === identity.kind &&
				winner.inputDigest === identity.digest &&
				isPayload(winner.payload)
			) {
				traceProjectionCache("cache.publish.complete", {
					kind: identity.kind,
					key: identity.key,
				});
				return structuredClone(winner.payload);
			}
			traceProjectionCache("cache.publish.race", {
				kind: identity.kind,
				key: identity.key,
			});
		} catch (error) {
			traceProjectionCache("cache.publish.error", {
				kind: identity.kind,
				key: identity.key,
				...projectionCacheErrorDetails(error),
			});
			// Derived artifacts are best-effort; computation remains authoritative.
		}
		return structuredClone(payload);
	}
}
