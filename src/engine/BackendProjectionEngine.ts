import type {
	EvaluationResultCollection,
	ProjectionResult,
	RawProjectionOutput,
	StochasticProjectionResult,
} from "@/lib/projection";
import type {
	ProgressCallback,
	ProjectionComputationEngine,
	ProjectionEvaluationRequest,
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";

// BackendProjectionEngine routes all projection computation to the Go
// backend (chi + huma) over HTTP/SSE. Computation no longer runs in browser
// workers; see docs/backend-migration/ASSUMPTIONS.md A2/A4.

const API_BASE = "/v1";

type StochasticStreamEvent = {
	progress?: unknown;
	partial?: unknown;
	result?: unknown;
	error?: string;
};

async function postJson<TResponse>(
	path: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<TResponse> {
	const response = await fetch(`${API_BASE}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal,
	});
	const payload = (await response.json()) as TResponse & {
		error?: string;
	};
	if (!response.ok) {
		throw new Error(
			payload.error ?? `Backend request failed (${response.status}).`,
		);
	}
	return payload;
}

export class BackendProjectionEngine implements ProjectionComputationEngine {
	async project(request: ProjectionRequest): Promise<ProjectionResult> {
		const payload = await postJson<{
			result?: ProjectionResult;
			error?: string;
			issues?: unknown[];
		}>(
			"/projections/deterministic",
			{
				document: request.document,
				incomeData: request.incomeData,
				settings: request.projectionSettings,
				overrides: request.overrides,
			},
			request.signal,
		);
		if (payload.error) throw new Error(payload.error);
		if (!payload.result) {
			throw new Error("Backend returned no projection result.");
		}
		return payload.result;
	}

	async projectBase(_request: ProjectionRequest): Promise<RawProjectionOutput> {
		throw new Error(
			"Base-only projections are not exposed by the backend engine.",
		);
	}

	async evaluateProjection(
		_request: ProjectionEvaluationRequest,
	): Promise<EvaluationResultCollection> {
		throw new Error(
			"Evaluation-only requests are not exposed by the backend engine.",
		);
	}

	async projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult> {
		const controller = new AbortController();
		const abortHandler = () => controller.abort();
		if (request.signal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		request.signal?.addEventListener("abort", abortHandler, { once: true });

		try {
			const response = await fetch(`${API_BASE}/projections/stochastic`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					document: request.document,
					incomeData: request.incomeData,
					settings: request.projectionSettings,
					overrides: request.overrides,
					config: request.config,
				}),
				signal: controller.signal,
			});
			if (!response.ok || !response.body) {
				const detail = await response.text().catch(() => "");
				throw new Error(
					detail || `Stochastic stream failed (${response.status}).`,
				);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let finalResult: StochasticProjectionResult | null = null;
			let streamError: string | null = null;

			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let separatorIndex = buffer.indexOf("\n\n");
				while (separatorIndex >= 0) {
					const rawEvent = buffer.slice(0, separatorIndex);
					buffer = buffer.slice(separatorIndex + 2);
					separatorIndex = buffer.indexOf("\n\n");
					const event = parseSseEvent(rawEvent);
					if (!event) continue;
					let parsed: StochasticStreamEvent;
					try {
						parsed = JSON.parse(event.data) as StochasticStreamEvent;
					} catch {
						continue;
					}
					if (event.name === "progress" && parsed.progress) {
						onProgress?.(parsed.progress as Parameters<ProgressCallback>[0]);
					} else if (
						event.name === "partial" &&
						parsed.progress &&
						parsed.partial
					) {
						onProgress?.(
							parsed.progress as Parameters<ProgressCallback>[0],
							parsed.partial as StochasticProjectionResult,
						);
					} else if (event.name === "result" && parsed.result) {
						finalResult = parsed.result as StochasticProjectionResult;
					} else if (event.name === "error") {
						streamError = parsed.error ?? "Stochastic projection failed.";
					}
				}
			}

			if (streamError) throw new Error(streamError);
			if (!finalResult) {
				throw new Error("Stochastic stream ended without a result.");
			}
			return finalResult;
		} catch (error) {
			if (
				error instanceof DOMException ||
				(error instanceof Error && error.name === "AbortError")
			) {
				throw new DOMException("Aborted", "AbortError");
			}
			throw error instanceof Error
				? error
				: new Error("Stochastic projection failed.");
		} finally {
			request.signal?.removeEventListener("abort", abortHandler);
		}
	}
}

function parseSseEvent(
	rawEvent: string,
): { name: string; data: string } | null {
	let name = "message";
	const dataLines: string[] = [];
	for (const line of rawEvent.split("\n")) {
		if (line.startsWith("event:")) {
			name = line.slice(6).trim();
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice(5).trimStart());
		}
	}
	if (dataLines.length === 0) return null;
	return { name, data: dataLines.join("\n") };
}
