import { buildApiUrl } from "@/lib/apiUrl";
import type {
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import {
	identityPrefix,
	logRecalculation,
	projectionRequestIdentity,
} from "@/lib/projection/runtime/computationIdentity";
import type {
	ProgressCallback,
	ProjectionEngine,
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";

// BackendProjectionEngine routes all projection computation to the Go
// backend (chi + huma) over HTTP/SSE. Computation no longer runs in browser
// workers; see docs/backend-migration/ASSUMPTIONS.md A2/A4.
//
// Recovery contract (browser backgrounding): the client re-POSTs the same
// body, preserving the last progress/partial across attempts so the UI never
// flashes to empty. The server attaches the reconnect to the still-running
// computation (or its cached result). The server sends a `retry` hint plus
// `: heartbeat` comments; heartbeats keep idle proxies/NAT from killing long
// batches, and a per-attempt stall timer converts a frozen tab (no bytes for
// STALL_TIMEOUT_MS) into a bounded reconnect instead of a hung spinner.
// Server `error` events and HTTP 4xx are terminal (marked with
// TERMINAL_ERROR_CODE) and never retried; only network failures, HTTP 5xx,
// stalls, and truncated streams (closed without a result) reconnect.

const API_BASE = buildApiUrl("/v1");

const MAX_ATTEMPTS = 3;
const STALL_TIMEOUT_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;

const TERMINAL_ERROR_CODE = "projection-terminal";

type StochasticStreamEvent = {
	progress?: unknown;
	partial?: unknown;
	result?: unknown;
	error?: string;
};

// Terminal failures (server `error` events, HTTP 4xx) must never reconnect.
// They are plain Errors tagged with a code instead of a dedicated subclass.
function terminalError(message: string): Error {
	const error = new Error(message);
	(error as Error & { code?: string }).code = TERMINAL_ERROR_CODE;
	return error;
}

function isTerminalError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error as Error & { code?: string }).code === TERMINAL_ERROR_CODE
	);
}

function isAbortError(error: unknown): boolean {
	return (
		error instanceof DOMException ||
		(error instanceof Error && error.name === "AbortError")
	);
}

// classifyStreamFailure names why a reconnectable attempt failed, so the
// attempt-failed log line explains whether the server, the proxy, or the
// browser's background throttling broke the stream.
function classifyStreamFailure(error: unknown): string {
	if (!(error instanceof Error)) return "unknown";
	if (error instanceof TypeError) return "network";
	const message = error.message;
	if (message === "Stochastic stream stalled.") return "stalled";
	if (message === "Stochastic stream ended without a result.") {
		return "truncated";
	}
	if (/^Stochastic stream failed \(5/.test(message)) return "http-5xx";
	return "unknown";
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException("Aborted", "AbortError"));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException("Aborted", "AbortError"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

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

export class BackendProjectionEngine implements ProjectionEngine {
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
			},
			request.signal,
		);
		if (payload.error) throw new Error(payload.error);
		if (!payload.result) {
			throw new Error("Backend returned no projection result.");
		}
		return payload.result;
	}

	async projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult> {
		if (request.signal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		const body = JSON.stringify({
			document: request.document,
			incomeData: request.incomeData,
			settings: request.projectionSettings,
			config: request.config,
		});
		let serverRetryMs = RECONNECT_BASE_DELAY_MS;
		let lastError: unknown = null;
		const identity = identityPrefix(
			projectionRequestIdentity({
				document: request.document,
				settings: request.projectionSettings,
				incomeData: request.incomeData,
				extra: request.config,
			}),
		);

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			if (request.signal?.aborted) {
				throw new DOMException("Aborted", "AbortError");
			}
			if (attempt > 0) {
				await sleep(serverRetryMs * 2 ** (attempt - 1), request.signal);
			}
			try {
				const result = await this.readStreamAttempt(
					body,
					request.signal,
					(retryMs) => {
						if (retryMs !== null) serverRetryMs = retryMs;
					},
					onProgress,
				);
				if (attempt > 0) {
					logRecalculation("stochastic recovered", {
						identity,
						attempts: attempt + 1,
					});
				}
				return result;
			} catch (error) {
				if (isAbortError(error) && request.signal?.aborted) throw error;
				if (isTerminalError(error)) {
					logRecalculation("stochastic terminal", {
						identity,
						reason: error instanceof Error ? error.message : "unknown",
					});
					throw error;
				}
				lastError = error;
				logRecalculation("stochastic attempt failed", {
					identity,
					attempt: attempt + 1,
					reason: classifyStreamFailure(error),
				});
			}
		}
		logRecalculation("stochastic gave up", {
			identity,
			attempts: MAX_ATTEMPTS,
		});
		throw lastError instanceof Error
			? lastError
			: new Error("Stochastic projection failed.");
	}

	private async readStreamAttempt(
		body: string,
		outerSignal: AbortSignal | undefined,
		onRetryHint: (retryMs: number | null) => void,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult> {
		const controller = new AbortController();
		const abortHandler = () => controller.abort();
		let stalled = false;
		if (outerSignal?.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		outerSignal?.addEventListener("abort", abortHandler, { once: true });

		let stallTimer: ReturnType<typeof setTimeout> | undefined;
		const armStallTimer = () => {
			clearTimeout(stallTimer);
			stallTimer = setTimeout(() => {
				stalled = true;
				controller.abort();
			}, STALL_TIMEOUT_MS);
		};

		try {
			const response = await fetch(`${API_BASE}/projections/stochastic`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
				signal: controller.signal,
			});
			if (!response.ok || !response.body) {
				const detail = await response.text().catch(() => "");
				const status = response.status;
				if (status >= 400 && status < 500) {
					throw terminalError(
						detail || `Stochastic projection failed (${status}).`,
					);
				}
				throw new Error(detail || `Stochastic stream failed (${status}).`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let finalResult: StochasticProjectionResult | null = null;
			let streamError: string | null = null;

			armStallTimer();
			for (;;) {
				let read: ReadableStreamReadResult<Uint8Array>;
				try {
					read = await reader.read();
				} catch (error) {
					if (stalled) throw new Error("Stochastic stream stalled.");
					throw error;
				}
				if (read.done) break;
				armStallTimer();
				buffer += decoder.decode(read.value, { stream: true });
				let separatorIndex = buffer.indexOf("\n\n");
				while (separatorIndex >= 0) {
					const rawEvent = buffer.slice(0, separatorIndex);
					buffer = buffer.slice(separatorIndex + 2);
					separatorIndex = buffer.indexOf("\n\n");
					const event = parseSseEvent(rawEvent);
					if (!event) continue;
					if (event.retryMs !== null) onRetryHint(event.retryMs);
					if (event.name === null) continue;
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

			if (streamError) throw terminalError(streamError);
			if (!finalResult) {
				throw new Error("Stochastic stream ended without a result.");
			}
			return finalResult;
		} catch (error) {
			if (stalled) throw new Error("Stochastic stream stalled.");
			if (isAbortError(error)) {
				throw new DOMException("Aborted", "AbortError");
			}
			throw error instanceof Error
				? error
				: new Error("Stochastic projection failed.");
		} finally {
			clearTimeout(stallTimer);
			outerSignal?.removeEventListener("abort", abortHandler);
		}
	}
}

function parseSseEvent(rawEvent: string): {
	name: string | null;
	data: string;
	retryMs: number | null;
} | null {
	let name = "message";
	let retryMs: number | null = null;
	const dataLines: string[] = [];
	for (const line of rawEvent.split("\n")) {
		if (line.startsWith(":")) continue;
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const value = line.slice(colon + 1).trim();
		switch (line.slice(0, colon)) {
			case "event":
				name = value;
				break;
			case "data":
				dataLines.push(value);
				break;
			case "retry": {
				const parsed = Number.parseInt(value, 10);
				if (Number.isFinite(parsed) && parsed >= 0) retryMs = parsed;
				break;
			}
		}
	}
	if (dataLines.length === 0) {
		return retryMs !== null ? { name: null, data: "", retryMs } : null;
	}
	return { name, data: dataLines.join("\n"), retryMs };
}
