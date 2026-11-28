import { finite, isRecord, stringValue } from "../domain/guards.ts";
import { projectStochastic } from "./generated/endpoints.ts";
import type { StochasticRequest } from "./generated/model/stochasticRequest.ts";
import type {
	ErrorSSEData,
	EvaluationResultEnvelope,
	EvaluationResultTables,
	PartialSSEData,
	PercentileBands,
	ProgressSSEData,
	ResultSSEData,
	StochasticProgress,
	StochasticProjectionResult,
} from "./contracts.ts";

export interface ParsedSSEEvent {
	id?: string;
	event: string;
	data: unknown;
	rawData: string;
}

export interface SSEParserCallbacks {
	onRetry?: (retryMilliseconds: number) => void;
	onComment?: (comment: string) => void;
	onProgress?: (data: ProgressSSEData) => void;
	onPartial?: (data: PartialSSEData) => void;
	onResult?: (data: ResultSSEData) => void;
	onError?: (data: ErrorSSEData) => void;
	onEvent?: (event: ParsedSSEEvent) => void;
	onParseError?: (error: SSEParseError) => void;
}

export class SSEParseError extends Error {
	constructor(cause: unknown) {
		super("The server sent an invalid server-sent event payload.", { cause });
		this.name = "SSEParseError";
	}
}

export class SSETransportError extends Error {
	constructor(cause: unknown) {
		super(
			"The server-sent event stream could not be read. Check the connection and retry.",
			{ cause },
		);
		this.name = "SSETransportError";
	}
}

type StreamSource =
	| ReadableStream<Uint8Array>
	| AsyncIterable<Uint8Array | string>;
export type SSEInput = Response | StreamSource | string;

const PERCENTILE_KEYS = ["p10", "p25", "p50", "p75", "p90"] as const;

function isPercentileBands(value: unknown): value is PercentileBands {
	return (
		isRecord(value) &&
		PERCENTILE_KEYS.every((key) => finite(value[key]) !== null)
	);
}

function isSafeInteger(value: unknown): value is number {
	return finite(value) !== null && Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
	return isSafeInteger(value) && value >= 0;
}

function isStochasticProgress(value: unknown): value is StochasticProgress {
	if (!isRecord(value)) return false;
	const fraction = finite(value.fraction);
	return (
		isNonNegativeInteger(value.completedRuns) &&
		isNonNegativeInteger(value.totalRuns) &&
		fraction !== null &&
		fraction >= 0 &&
		fraction <= 1
	);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => stringValue(item) !== null)
	);
}

function isEvaluationDiagnostic(value: unknown): boolean {
	return (
		isRecord(value) &&
		stringValue(value.code) !== null &&
		stringValue(value.severity) !== null &&
		stringValue(value.message) !== null &&
		(value.date === undefined || stringValue(value.date) !== null) &&
		(value.relatedAccountIds === undefined ||
			isStringArray(value.relatedAccountIds)) &&
		(value.relatedTransactionIds === undefined ||
			isStringArray(value.relatedTransactionIds))
	);
}

function isEvaluationEnvelope(
	value: unknown,
): value is EvaluationResultEnvelope {
	return (
		isRecord(value) &&
		stringValue(value.instanceId) !== null &&
		typeof value.name === "string" &&
		stringValue(value.status) !== null &&
		Object.hasOwn(value, "deterministic") &&
		Object.hasOwn(value, "probabilistic") &&
		Array.isArray(value.diagnostics) &&
		value.diagnostics.every(isEvaluationDiagnostic)
	);
}

function isEvaluationRows(value: unknown): value is EvaluationResultEnvelope[] {
	return Array.isArray(value) && value.every(isEvaluationEnvelope);
}

function isEvaluationTables(value: unknown): value is EvaluationResultTables {
	if (!isRecord(value)) return false;
	const required = [
		"financialIndependence",
		"netWorthThreshold",
		"accountBalance",
		"transactionFulfillment",
	] as const;
	const optional = ["cycleFulfillment", "plannedPurchases", "whatIf"] as const;
	return (
		required.every((key) => isEvaluationRows(value[key])) &&
		optional.every(
			(key) => value[key] === undefined || isEvaluationRows(value[key]),
		)
	);
}

function isStochasticProjectionResult(
	value: unknown,
): value is StochasticProjectionResult {
	if (!isRecord(value) || !isRecord(value.config)) return false;
	return (
		isNonNegativeInteger(value.config.runCount) &&
		value.config.runCount > 0 &&
		(value.config.seed === null || isSafeInteger(value.config.seed)) &&
		Array.isArray(value.bands) &&
		value.bands.every(
			(band) =>
				isRecord(band) &&
				stringValue(band.date) !== null &&
				typeof band.isHistorical === "boolean" &&
				isPercentileBands(band.netWorth),
		) &&
		isRecord(value.milestones) &&
		isPercentileBands(value.milestones.finalNetWorthPercentiles) &&
		isEvaluationTables(value.evaluations)
	);
}

function isProgressSSEData(value: unknown): value is ProgressSSEData {
	return isRecord(value) && isStochasticProgress(value.progress);
}

function isPartialSSEData(value: unknown): value is PartialSSEData {
	return (
		isRecord(value) &&
		isStochasticProgress(value.progress) &&
		isStochasticProjectionResult(value.partial)
	);
}

function isResultSSEData(value: unknown): value is ResultSSEData {
	return isRecord(value) && isStochasticProjectionResult(value.result);
}

function isErrorSSEData(value: unknown): value is ErrorSSEData {
	return isRecord(value) && stringValue(value.error) !== null;
}

function dispatchEvent(
	event: ParsedSSEEvent,
	callbacks: SSEParserCallbacks,
): SSEParseError | null {
	callbacks.onEvent?.(event);
	if (event.event === "progress") {
		if (!isProgressSSEData(event.data)) return invalidEventPayload(event.event);
		callbacks.onProgress?.(event.data);
	}
	if (event.event === "partial") {
		if (!isPartialSSEData(event.data)) return invalidEventPayload(event.event);
		callbacks.onPartial?.(event.data);
	}
	if (event.event === "result") {
		if (!isResultSSEData(event.data)) return invalidEventPayload(event.event);
		callbacks.onResult?.(event.data);
	}
	if (event.event === "error") {
		if (!isErrorSSEData(event.data)) return invalidEventPayload(event.event);
		callbacks.onError?.(event.data);
	}
	return null;
}

function invalidEventPayload(eventName: string): SSEParseError {
	return new SSEParseError(
		new Error(`The ${eventName} event payload has an invalid shape.`),
	);
}

function parseBlock(
	block: string,
	callbacks: SSEParserCallbacks,
): ParsedSSEEvent | Error | null {
	let eventName = "message";
	let id: string | undefined;
	const data: string[] = [];
	let hasData = false;
	let retryMilliseconds: number | null = null;

	for (const line of block.split(/\r\n|\n|\r/)) {
		if (!line) continue;
		if (line.startsWith(":")) {
			callbacks.onComment?.(line.slice(1).replace(/^ /, ""));
			continue;
		}
		const separator = line.indexOf(":");
		const field = separator < 0 ? line : line.slice(0, separator);
		const rawValue = separator < 0 ? "" : line.slice(separator + 1);
		const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
		if (field === "event") eventName = value;
		if (field === "data") {
			hasData = true;
			data.push(value);
		}
		if (field === "id" && !value.includes("\0")) id = value;
		if (field === "retry") {
			const parsed = Number(value);
			if (Number.isInteger(parsed) && parsed >= 0) retryMilliseconds = parsed;
		}
	}

	if (retryMilliseconds !== null) callbacks.onRetry?.(retryMilliseconds);
	if (!hasData) return null;
	const rawData = data.join("\n");
	const parsed = (() => {
		try {
			return JSON.parse(rawData) as unknown;
		} catch (cause) {
			return new SSEParseError(cause);
		}
	})();
	if (parsed instanceof Error) return parsed;
	if (!isRecord(parsed))
		return new SSEParseError(new Error("SSE data must be a JSON object."));
	const event: ParsedSSEEvent = {
		event: eventName,
		data: parsed,
		rawData,
		...(id === undefined ? {} : { id }),
	};
	return event;
}

function findBlockEnd(value: string): { index: number; length: number } | null {
	const match = /\r\n\r\n|\r\n\n|\n\r\n|\n\n|\r\r/.exec(value);
	return match ? { index: match.index, length: match[0].length } : null;
}

export class SSEParser {
	private readonly decoder = new TextDecoder();
	private buffer = "";
	private failure: SSEParseError | null = null;
	private readonly callbacks: SSEParserCallbacks;

	constructor(callbacks: SSEParserCallbacks = {}) {
		this.callbacks = callbacks;
	}

	get error(): SSEParseError | null {
		return this.failure;
	}

	/** Parse one complete block, dispatch its event, and record parse failures. */
	private applyBlock(block: string): ParsedSSEEvent[] | SSEParseError {
		const parsed = parseBlock(block, this.callbacks);
		if (parsed instanceof Error) {
			this.failure =
				parsed instanceof SSEParseError ? parsed : new SSEParseError(parsed);
			this.callbacks.onParseError?.(this.failure);
			return this.failure;
		}
		if (!parsed) return [];
		const dispatchError = dispatchEvent(parsed, this.callbacks);
		if (dispatchError) {
			this.failure = dispatchError;
			this.callbacks.onParseError?.(this.failure);
			return this.failure;
		}
		return [parsed];
	}

	feed(chunk: Uint8Array | string): ParsedSSEEvent[] {
		if (this.failure) return [];
		const text =
			typeof chunk === "string"
				? chunk
				: this.decoder.decode(chunk, { stream: true });
		this.buffer += text;
		const events: ParsedSSEEvent[] = [];
		while (true) {
			const end = findBlockEnd(this.buffer);
			if (!end) break;
			const block = this.buffer.slice(0, end.index);
			this.buffer = this.buffer.slice(end.index + end.length);
			const applied = this.applyBlock(block);
			if (applied instanceof Error) break;
			events.push(...applied);
		}
		return events;
	}

	finish(): ParsedSSEEvent[] | SSEParseError {
		if (this.failure) return this.failure;
		this.buffer += this.decoder.decode();
		if (this.buffer.trim()) {
			const applied = this.applyBlock(this.buffer);
			this.buffer = "";
			return applied;
		}
		this.buffer = "";
		return [];
	}
}

function abortError(): SSETransportError {
	return new SSETransportError(
		new DOMException("The event stream was aborted.", "AbortError"),
	);
}

/** Expose a reader as a chunk iterable so every transport shares one loop. */
async function* readerChunks(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
	while (true) {
		if (signal?.aborted) throw abortError();
		const chunk = await reader.read();
		if (signal?.aborted) throw abortError();
		if (chunk.done) return;
		if (chunk.value) yield chunk.value;
	}
}

function finishParser(parser: SSEParser): SSEParseError | null {
	const finished = parser.finish();
	return finished instanceof Error ? finished : null;
}

async function consumeChunks(
	source: AsyncIterable<Uint8Array | string>,
	parser: SSEParser,
	signal?: AbortSignal,
): Promise<SSEParseError | SSETransportError | null> {
	try {
		for await (const chunk of source) {
			if (signal?.aborted) return abortError();
			parser.feed(chunk);
			if (parser.error) return parser.error;
		}
	} catch (cause) {
		if (cause instanceof SSEParseError || cause instanceof SSETransportError)
			return cause;
		return new SSETransportError(cause);
	}
	return finishParser(parser);
}

export async function parseSSE(
	input: SSEInput,
	callbacks: SSEParserCallbacks = {},
	signal?: AbortSignal,
): Promise<SSEParseError | SSETransportError | null> {
	const parser = new SSEParser(callbacks);
	if (typeof input === "string") {
		parser.feed(input);
		if (parser.error) return parser.error;
		return finishParser(parser);
	}
	if (typeof Response !== "undefined" && input instanceof Response) {
		if (!input.body)
			return new SSETransportError(
				new Error("The event response has no body."),
			);
		const reader = input.body.getReader();
		try {
			return await consumeChunks(readerChunks(reader, signal), parser, signal);
		} finally {
			reader.releaseLock();
		}
	}
	if ("getReader" in input && typeof input.getReader === "function")
		return consumeChunks(
			readerChunks(input.getReader(), signal),
			parser,
			signal,
		);
	return consumeChunks(
		input as AsyncIterable<Uint8Array | string>,
		parser,
		signal,
	);
}

export type { StochasticProgress, StochasticProjectionResult };

export type StochasticRequestOptions = {
	signal?: AbortSignal;
};

/** POST the stochastic projection and return the SSE stream. The streaming
 * response bypasses the JSON envelope handling: callers consume events. */
export async function requestStochasticProjection(
	request: unknown,
	options: StochasticRequestOptions = {},
): Promise<Response> {
	return projectStochastic(request as StochasticRequest, {
		signal: options.signal,
		headers: { accept: "text/event-stream" },
	});
}
