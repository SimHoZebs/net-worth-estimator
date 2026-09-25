import type {
	ErrorSSEData,
	PartialSSEData,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventPayload<T>(value: unknown): T {
	return value as T;
}

function dispatchEvent(
	event: ParsedSSEEvent,
	callbacks: SSEParserCallbacks,
): void {
	callbacks.onEvent?.(event);
	if (event.event === "progress")
		callbacks.onProgress?.(eventPayload<ProgressSSEData>(event.data));
	if (event.event === "partial")
		callbacks.onPartial?.(eventPayload<PartialSSEData>(event.data));
	if (event.event === "result")
		callbacks.onResult?.(eventPayload<ResultSSEData>(event.data));
	if (event.event === "error")
		callbacks.onError?.(eventPayload<ErrorSSEData>(event.data));
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

	feed(chunk: Uint8Array | string): ParsedSSEEvent[] {
		if (this.failure) return [];
		const text =
			typeof chunk === "string"
				? chunk
				: this.decoder.decode(chunk, { stream: true });
		this.buffer += text;
		const events: ParsedSSEEvent[] = [];
		const consume = (): boolean => {
			const end = findBlockEnd(this.buffer);
			if (!end) return true;
			const block = this.buffer.slice(0, end.index);
			this.buffer = this.buffer.slice(end.index + end.length);
			const parsed = parseBlock(block, this.callbacks);
			if (parsed instanceof Error) {
				this.failure =
					parsed instanceof SSEParseError ? parsed : new SSEParseError(parsed);
				this.callbacks.onParseError?.(this.failure);
				return false;
			}
			if (parsed) {
				dispatchEvent(parsed, this.callbacks);
				events.push(parsed);
			}
			return true;
		};
		while (consume()) {
			if (!findBlockEnd(this.buffer)) break;
		}
		return events;
	}

	finish(): ParsedSSEEvent[] | SSEParseError {
		if (this.failure) return this.failure;
		const tail = this.decoder.decode();
		this.buffer += tail;
		if (this.buffer.trim()) {
			const parsed = parseBlock(this.buffer, this.callbacks);
			this.buffer = "";
			if (parsed instanceof Error) {
				this.failure =
					parsed instanceof SSEParseError ? parsed : new SSEParseError(parsed);
				this.callbacks.onParseError?.(this.failure);
				return this.failure;
			}
			if (parsed) {
				dispatchEvent(parsed, this.callbacks);
				return [parsed];
			}
		}
		this.buffer = "";
		return [];
	}

	push(chunk: Uint8Array | string): ParsedSSEEvent[] {
		return this.feed(chunk);
	}

	end(): ParsedSSEEvent[] | SSEParseError {
		return this.finish();
	}
}

export function createSSEParser(callbacks: SSEParserCallbacks = {}): SSEParser {
	return new SSEParser(callbacks);
}

async function consumeReader(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	parser: SSEParser,
	signal?: AbortSignal,
): Promise<SSEParseError | SSETransportError | null> {
	try {
		while (true) {
			if (signal?.aborted)
				return new SSETransportError(
					new DOMException("The event stream was aborted.", "AbortError"),
				);
			const chunk = await reader.read();
			if (signal?.aborted)
				return new SSETransportError(
					new DOMException("The event stream was aborted.", "AbortError"),
				);
			if (chunk.done) break;
			if (!chunk.value) continue;
			parser.feed(chunk.value);
			if (parser.error) return parser.error;
		}
	} catch (cause) {
		return cause instanceof SSEParseError
			? cause
			: new SSETransportError(cause);
	}
	const finished = parser.finish();
	return finished instanceof Error ? finished : null;
}

async function consumeAsyncIterable(
	source: AsyncIterable<Uint8Array | string>,
	parser: SSEParser,
	signal?: AbortSignal,
): Promise<SSEParseError | SSETransportError | null> {
	try {
		for await (const chunk of source) {
			if (signal?.aborted)
				return new SSETransportError(
					new DOMException("The event stream was aborted.", "AbortError"),
				);
			parser.feed(chunk);
			if (parser.error) return parser.error;
		}
	} catch (cause) {
		return cause instanceof SSEParseError
			? cause
			: new SSETransportError(cause);
	}
	const finished = parser.finish();
	return finished instanceof Error ? finished : null;
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
		const finished = parser.finish();
		return finished instanceof Error ? finished : null;
	}
	if (typeof Response !== "undefined" && input instanceof Response) {
		if (!input.body)
			return new SSETransportError(
				new Error("The event response has no body."),
			);
		const reader = input.body.getReader();
		try {
			return await consumeReader(reader, parser, signal);
		} finally {
			reader.releaseLock();
		}
	}
	if ("getReader" in input && typeof input.getReader === "function")
		return consumeReader(input.getReader(), parser, signal);
	return consumeAsyncIterable(
		input as AsyncIterable<Uint8Array | string>,
		parser,
		signal,
	);
}

export const parsePostSSE = parseSSE;
export const parsePostSse = parseSSE;
export const createPostSSEParser = createSSEParser;
export type { StochasticProgress, StochasticProjectionResult };
