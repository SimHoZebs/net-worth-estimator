import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { vi } from "vitest";
import { suspendUserScope } from "../auth/resourceScope.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import { acceptTestResource } from "./resource.ts";

// Static matchMedia stub for viewport-dependent tests. Tests that drive
// breakpoint transitions keep their own listener-tracking stub.
export function stubMatchMedia(matches: boolean): void {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
}

// One query-client scope per test: fresh cache plus the verified test user.
// Files with extra state (sync stamps, settings clients) reset those locally.
export function setupQueryScope(): void {
	vi.unstubAllGlobals();
	resetServerQueryCache();
	acceptTestResource();
}

export function teardownQueryScope(): void {
	cleanup();
	suspendUserScope();
	resetServerQueryCache();
	vi.unstubAllGlobals();
}

// Shared QueryClientProvider wrapper for hook and page tests.
export function ServerQueryWrapper({ children }: { children: ReactNode }) {
	return createElement(
		QueryClientProvider,
		{ client: serverQueryClient() },
		children,
	);
}

// Deferred promise for gating one fetch leg behind another.
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Request log for fetch spies: url, method, and the scoped resource header.
export function recordedRequests(fetcher: ReturnType<typeof vi.fn>) {
	return fetcher.mock.calls.map((call) => {
		const [url, init] = call as [string, RequestInit | undefined];
		return {
			url: String(url),
			method: init?.method ?? "GET",
			resource: new Headers(init?.headers).get("Waypoint-Resource"),
		};
	});
}
