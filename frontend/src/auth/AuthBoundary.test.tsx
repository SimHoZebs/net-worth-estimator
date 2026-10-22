import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthBoundary } from "./AuthBoundary.tsx";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { redirectToSignIn } from "./navigation.ts";
import { SessionAccountControl } from "./SessionAccountControl.tsx";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

const sampleResource = {
	id: "plans/sample",
	kind: "sample",
	permissions: ["plan:read", "plan:project"],
};
const privateResource = {
	id: `plans/${"a".repeat(64)}`,
	kind: "private",
	permissions: ["plan:read", "plan:project", "plan:write"],
};

beforeEach(() => vi.stubGlobal("BroadcastChannel", undefined));

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function status(body: unknown, code = 200) {
	const headers = new Headers({ "content-type": "application/json" });
	if (
		body &&
		typeof body === "object" &&
		"resource" in body &&
		body.resource &&
		typeof body.resource === "object" &&
		"id" in body.resource
	)
		headers.set("X-Waypoint-Resource", String(body.resource.id));
	return new Response(JSON.stringify(body), {
		status: code,
		headers,
	});
}

describe("provider-independent authentication boundary", () => {
	it("keeps legacy deployments unchanged", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => status({ enabled: false })),
		);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("mounts an allowed guest workspace without a forced sign-in redirect", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: false,
					allowed: true,
					resource: sampleResource,
					user: { subject: "", name: "", role: "viewer" },
				}),
			),
		);
		render(
			<AuthBoundary>
				<p>Public workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Public workspace")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Continue to sign in" }),
		).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("supports legacy backends that redirect anonymous users instead of guest access", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({ enabled: true, authenticated: false, allowed: false }),
			),
		);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(
			await screen.findByRole("button", { name: "Continue to sign in" }),
		).toBeTruthy();
		expect(
			screen.getByText("Redirecting for sign-in or account creation…"),
		).toBeTruthy();
		expect(screen.queryByText("Private workspace")).toBeNull();
		await waitFor(() => expect(redirectToSignIn).toHaveBeenCalled());
	});
	it.each([false, undefined])(
		"fails closed on inconsistent authenticated access %s with retry and sign-out",
		async (allowed) => {
			const fetcher = vi.fn(async () =>
				status({
					enabled: true,
					authenticated: true,
					allowed,
					user: { subject: "known-account", name: "User", role: "editor" },
				}),
			);
			vi.stubGlobal("fetch", fetcher);
			render(
				<AuthBoundary>
					<p>Public workspace</p>
				</AuthBoundary>,
			);
			expect(
				await screen.findByRole("heading", {
					name: "Session access is unavailable",
				}),
			).toBeTruthy();
			expect(screen.getByRole("alert").textContent).toBe(
				"Your session could not be verified.",
			);
			expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
			expect(
				screen.queryByText(/server owner|grant.*access|OIDC subject/i),
			).toBeNull();
			expect(screen.queryByText("Public workspace")).toBeNull();
			expect(redirectToSignIn).not.toHaveBeenCalled();
			fetcher.mockImplementation(async () =>
				status({
					enabled: true,
					authenticated: true,
					allowed: true,
					resource: privateResource,
					user: { subject: "known-account", name: "User", role: "editor" },
				}),
			);
			fireEvent.click(
				screen.getByRole("button", { name: "Retry access check" }),
			);
			expect(await screen.findByText("Public workspace")).toBeTruthy();
		},
	);
	it("retains guest workspace access when a verified editor's session expires", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateResource,
				user: { subject: "known-account", name: "User", role: "editor" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<SessionAccountControl />
				<p>Public workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("User")).toBeTruthy();
		expect(screen.getByText("Public workspace")).toBeTruthy();
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: true,
				resource: sampleResource,
			}),
		);
		window.dispatchEvent(new Event("waypoint:authentication-required"));
		await screen.findByText("Guest");
		expect(screen.getByText("Public workspace")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("fails closed on unavailable or malformed discovery", async () => {
		const fetcher = vi.fn(async () => status({}, 503));
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.queryByText("Private workspace")).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fetcher.mockImplementation(async () => status({ enabled: false }));
		fireEvent.click(screen.getByRole("button", { name: "Retry access check" }));
		await waitFor(() =>
			expect(screen.getByText("Private workspace")).toBeTruthy(),
		);
	});
});
