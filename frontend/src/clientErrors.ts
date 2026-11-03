// Fire-and-forget browser error beacon. It reports window errors and
// unhandled promise rejections to the backend, which logs one structured
// line per report. sendBeacon cannot set custom headers, so the backend
// exempts this one route from the Waypoint-Resource assertion; it carries
// no scope semantics and requires only user:read. The module never throws,
// never retries, and never blocks rendering: a broken beacon must not
// become a second failure.

const MAX_MESSAGE = 1024;
const MAX_STACK = 8192;
const MAX_PATH = 512;

export type ClientErrorSource = "error" | "unhandledrejection";

export interface ClientErrorReport {
	message: string;
	stack?: string;
	source: ClientErrorSource;
	path: string;
}

function bounded(value: unknown, limit: number): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	return value.length > limit ? value.slice(0, limit) : value;
}

function errorFields(error: unknown): { message?: string; stack?: string } {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: typeof error === "string" ? error : String(error) };
}

// Build the report shared by both listeners and the React error boundary.
export function buildReport(
	source: ClientErrorSource,
	error: unknown,
	path: string = window.location.pathname,
): ClientErrorReport {
	const fields = errorFields(error);
	return {
		message: bounded(fields.message, MAX_MESSAGE) ?? "Unknown error",
		stack: bounded(fields.stack, MAX_STACK),
		source,
		path: bounded(path, MAX_PATH) ?? "/",
	};
}

// Ship a report to the backend. Any failure is swallowed by design.
export function reportClientError(report: ClientErrorReport): void {
	try {
		const beacon = navigator.sendBeacon?.bind(navigator);
		if (!beacon) return; // Older browsers and test DOMs silently skip reporting.
		const payload = JSON.stringify(report);
		beacon(
			"/v1/client-errors",
			new Blob([payload], { type: "application/json" }),
		);
	} catch {
		// Never throw from an error path.
	}
}

let installed = false;

// Install the global listeners once. React render errors go through
// reportClientError from the error boundary instead.
export function installClientErrors(): void {
	if (installed) return;
	installed = true;
	try {
		window.addEventListener("error", (event: ErrorEvent) => {
			reportClientError(buildReport("error", event.error ?? event.message));
		});
		window.addEventListener(
			"unhandledrejection",
			(event: PromiseRejectionEvent) => {
				reportClientError(buildReport("unhandledrejection", event.reason));
			},
		);
	} catch {
		// Listener installation must never break startup.
	}
}
