import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthBoundary } from "./AuthBoundary.tsx";
import { resetServerQueryCache } from "../state/serverQuery.ts";
import { redirectToSignIn } from "./navigation.ts";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function status(body: unknown, code = 200) {
	return new Response(JSON.stringify(body), {
		status: code,
		headers: { "content-type": "application/json" },
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
	it("redirects anonymous users without mounting the financial workspace", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({ enabled: true, provider: "casdoor", authenticated: false }),
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
		expect(screen.queryByText("Private workspace")).toBeNull();
		await waitFor(() => expect(redirectToSignIn).toHaveBeenCalled());
	});
	it("requires an application grant, not just successful authentication", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: true,
					allowed: false,
					user: { subject: "not-invited", name: "User", role: "" },
				}),
			),
		);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(
			await screen.findByRole("heading", {
				name: "Access has not been granted",
			}),
		).toBeTruthy();
		expect(screen.getByText("OIDC subject: not-invited")).toBeTruthy();
		expect(screen.queryByText("Private workspace")).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("mounts the workspace for an allowed viewer and reacts to expiry", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				user: { subject: "reader", name: "Reader", role: "viewer" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(screen.getByText("Reader · Read only")).toBeTruthy();
		fetcher.mockImplementation(async () =>
			status({ enabled: true, provider: "casdoor", authenticated: false }),
		);
		window.dispatchEvent(new Event("waypoint:authentication-required"));
		await screen.findByRole("button", { name: "Continue to sign in" });
		expect(screen.queryByText("Private workspace")).toBeNull();
		await waitFor(() => expect(redirectToSignIn).toHaveBeenCalled());
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
