import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthBoundary } from "@/auth/AuthBoundary.tsx";
import { redirectToSignIn } from "@/auth/navigation.ts";
import { useSession } from "@/auth/sessionContext.ts";
import { NotificationCenter } from "@/components/NotificationCenter.tsx";
import { resetNotifications } from "@/state/notifications.ts";
import { resetServerQueryCache } from "@/state/serverQuery.ts";
import { GUEST_USER_ID, GUEST_USER_SUBJECT } from "@/mocks/resource.ts";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

function StatusProbe() {
	const account = useSession();
	return (
		<p data-testid="session-status">
			{`${account?.phase ?? "none"}:${account?.error ?? ""}`}
		</p>
	);
}

function SessionProbe() {
	const account = useSession();
	const session = account?.session ?? null;
	if (!session?.allowed) return null;
	const logout = account?.logout ?? (async () => {});
	const logoutPending = account?.logoutPending ?? false;
	if (!session.authenticated)
		return (
			<div>
				<p>Guest</p>
				<button
					type="button"
					onClick={() => {
						redirectToSignIn();
					}}
				>
					Sign in
				</button>
			</div>
		);
	return (
		<div>
			<p>{session.user?.name || session.user?.subject}</p>
			<button
				type="button"
				disabled={logoutPending}
				onClick={() => {
					void logout();
				}}
			>
				Sign out
			</button>
		</div>
	);
}

// The guest is an ordinary provisioned user: canonical id plus subject,
// signed out. Only `authenticated` differs, and it drives sign-in UX.
const guestAccount = {
	id: GUEST_USER_ID,
	permissions: ["user:read", "user:project"],
};
const privateAccount = {
	id: `users/${"a".repeat(64)}`,
	permissions: ["user:read", "user:project", "user:write"],
};
const guestUser = { subject: GUEST_USER_SUBJECT, name: "Guest" };

beforeEach(() => vi.stubGlobal("BroadcastChannel", undefined));

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	resetNotifications();
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
		headers.set("Waypoint-Resource", String(body.resource.id));
	return new Response(JSON.stringify(body), {
		status: code,
		headers,
	});
}

describe("provider-independent authentication boundary", () => {
	it("mounts an allowed guest workspace without a forced sign-in redirect", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: false,
					allowed: true,
					resource: guestAccount,
					user: guestUser,
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
	it("keeps children mounted on denial and exposes the denied phase without redirecting", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: false,
					allowed: false,
					resource: { ...guestAccount, permissions: [] },
					user: guestUser,
				}),
			),
		);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(screen.getByTestId("session-status").textContent).toBe(
			"denied:This user does not have access.",
		);
		expect(
			screen.queryByRole("heading", {
				name: "Workspace access is unavailable",
			}),
		).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("keeps the denied guest phase stable across re-verification", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: false,
				resource: { ...guestAccount, permissions: [] },
				user: guestUser,
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		const calls = fetcher.mock.calls.length;
		window.dispatchEvent(new Event("focus"));
		await waitFor(() =>
			expect(fetcher.mock.calls.length).toBeGreaterThan(calls),
		);
		expect(screen.getByTestId("session-status").textContent).toBe(
			"denied:This user does not have access.",
		);
		expect(screen.getByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("keeps denied accounts phase exposed while children stay mounted", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: false,
				resource: { ...privateAccount, permissions: [] },
				user: { subject: "known-account", name: "User" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Public workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Public workspace")).toBeTruthy();
		expect(screen.getByTestId("session-status").textContent).toBe(
			"denied:This user does not have access.",
		);
		expect(
			screen.queryByText(/server owner|grant.*access|OIDC subject/i),
		).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		fireEvent(window, new Event("focus"));
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe("ready:"),
		);
		expect(screen.getByText("Public workspace")).toBeTruthy();
	});
	it("retains guest workspace access when a verified editor's session expires", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<SessionProbe />
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
				resource: guestAccount,
				user: guestUser,
			}),
		);
		window.dispatchEvent(new Event("waypoint:authentication-required"));
		await screen.findByText("Guest");
		expect(screen.getByText("Public workspace")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("exposes unavailable phase while keeping children mounted", async () => {
		const fetcher = vi.fn(async () => status({}, 503));
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		const text = screen.getByTestId("session-status").textContent ?? "";
		expect(text.startsWith("unavailable:")).toBe(true);
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: true,
				resource: guestAccount,
				user: guestUser,
			}),
		);
		fireEvent(window, new Event("focus"));
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe("ready:"),
		);
		expect(screen.getByText("Private workspace")).toBeTruthy();
	});
	it("exposes a down server phase instead of idling on the loading state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => status({ error: "Bad Gateway" }, 502)),
		);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(screen.getByTestId("session-status").textContent).toBe(
			"unavailable:The Waypoint server is unavailable (HTTP 502). It may be restarting; retry shortly.",
		);
		expect(
			screen.queryByRole("button", { name: "Continue to sign in" }),
		).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("exposes a refused connection the same way", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(screen.getByTestId("session-status").textContent).toBe(
			"unavailable:Cannot reach the Waypoint server. It may be down or restarting.",
		);
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("keeps a verified user mounted with a retry toast on a transient outage", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
				<NotificationCenter />
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		fetcher.mockImplementationOnce(async () => status({}, 503));
		fireEvent(window, new Event("focus"));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("Private workspace")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Retry access check" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Session access is unavailable" }),
		).toBeNull();
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry access check" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(screen.getByText("Private workspace")).toBeTruthy();
	});
	it("exposes denied phase when a later check denies a previously allowed guest while children stay", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: true,
				resource: guestAccount,
				user: guestUser,
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: false,
				resource: guestAccount,
				user: guestUser,
			}),
		);
		window.dispatchEvent(new Event("focus"));
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		expect(screen.getByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		// A later re-verification keeps the same stable phase.
		const calls = fetcher.mock.calls.length;
		window.dispatchEvent(new Event("focus"));
		await waitFor(() =>
			expect(fetcher.mock.calls.length).toBeGreaterThan(calls),
		);
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("exposes denied phase again after the boundary unmounts and mounts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: false,
					allowed: false,
					resource: { ...guestAccount, permissions: [] },
					user: guestUser,
				}),
			),
		);
		const first = render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		expect(redirectToSignIn).not.toHaveBeenCalled();
		first.unmount();
		render(
			<AuthBoundary>
				<StatusProbe />
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("keeps the denied guest phase across a strict-mode remount", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				status({
					enabled: true,
					authenticated: false,
					allowed: false,
					resource: { ...guestAccount, permissions: [] },
					user: guestUser,
				}),
			),
		);
		render(
			<StrictMode>
				<AuthBoundary>
					<StatusProbe />
					<p>Private workspace</p>
				</AuthBoundary>
			</StrictMode>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		window.dispatchEvent(new Event("focus"));
		await waitFor(() =>
			expect(screen.getByTestId("session-status").textContent).toBe(
				"denied:This user does not have access.",
			),
		);
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("does not redirect on a transient outage for a verified user", async () => {
		const fetcher = vi.fn(async () =>
			status({
				enabled: true,
				authenticated: true,
				allowed: true,
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		vi.stubGlobal("fetch", fetcher);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
				<NotificationCenter />
			</AuthBoundary>,
		);
		expect(await screen.findByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
		fetcher.mockImplementationOnce(async () => status({}, 503));
		fireEvent(window, new Event("focus"));
		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("Private workspace")).toBeTruthy();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
});
