import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthBoundary } from "@/auth/AuthBoundary.tsx";
import { redirectToSignIn } from "@/auth/navigation.ts";
import { useSession } from "@/auth/sessionContext.ts";
import { NotificationCenter } from "@/components/NotificationCenter.tsx";
import { resetNotifications } from "@/state/notifications.ts";
import { resetServerQueryCache } from "@/state/serverQuery.ts";
import { GUEST_USER_ID, GUEST_USER_SUBJECT } from "@/mocks/resource.ts";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

function SessionProbe() {
	const account = useSession();
	if (!account?.session.allowed) return null;
	const { session, logout, logoutPending } = account;
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

let savedVisibilityState: PropertyDescriptor | undefined;
let visibilityStateTouched = false;

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	resetNotifications();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	if (visibilityStateTouched) {
		if (savedVisibilityState) {
			Object.defineProperty(document, "visibilityState", savedVisibilityState);
		} else {
			Reflect.deleteProperty(document, "visibilityState");
		}
		savedVisibilityState = undefined;
		visibilityStateTouched = false;
	}
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
	it("redirects denied guests to sign in when access is revoked", async () => {
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
	it("starts only one automatic sign-in across re-verification", async () => {
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
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		await screen.findByRole("button", { name: "Continue to sign in" });
		await waitFor(() => expect(redirectToSignIn).toHaveBeenCalledTimes(1));
		// Back-button restore, focus, and visibility re-verify the session.
		// Settle each re-verification first, then assert no second login
		// started that would orphan the first attempt.
		const settled = async () => {
			const calls = fetcher.mock.calls.length;
			await waitFor(() =>
				expect(fetcher.mock.calls.length).toBeGreaterThan(calls),
			);
			expect(screen.queryByText("Private workspace")).toBeNull();
		};
		window.dispatchEvent(new Event("focus"));
		await settled();
		expect(redirectToSignIn).toHaveBeenCalledTimes(1);
		savedVisibilityState = Object.getOwnPropertyDescriptor(
			document,
			"visibilityState",
		);
		visibilityStateTouched = true;
		Object.defineProperty(document, "visibilityState", {
			value: "visible",
			configurable: true,
		});
		document.dispatchEvent(new Event("visibilitychange"));
		await settled();
		expect(redirectToSignIn).toHaveBeenCalledTimes(1);
		const pageshow = new Event("pageshow");
		Object.defineProperty(pageshow, "persisted", { value: true });
		window.dispatchEvent(pageshow);
		await settled();
		expect(redirectToSignIn).toHaveBeenCalledTimes(1);
	});
	it("keeps denied accounts closed with retry and sign-out", async () => {
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
				<p>Public workspace</p>
			</AuthBoundary>,
		);
		expect(
			await screen.findByRole("heading", {
				name: "Session access is unavailable",
			}),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"This user does not have access.",
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
				resource: privateAccount,
				user: { subject: "known-account", name: "User" },
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry access check" }));
		expect(await screen.findByText("Public workspace")).toBeTruthy();
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
		fetcher.mockImplementation(async () =>
			status({
				enabled: true,
				authenticated: false,
				allowed: true,
				resource: guestAccount,
				user: guestUser,
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry access check" }));
		await waitFor(() =>
			expect(screen.getByText("Private workspace")).toBeTruthy(),
		);
	});
	it("names a down server with a retry action instead of idling on the loading state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => status({ error: "Bad Gateway" }, 502)),
		);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(
			await screen.findByRole("heading", { name: "Cannot reach your data." }),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"The Waypoint server is unavailable (HTTP 502). It may be restarting; retry shortly.",
		);
		expect(screen.getByText("Retry the access check below.")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Retry access check" }),
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Continue to sign in" }),
		).toBeNull();
		expect(screen.queryByText("Private workspace")).toBeNull();
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});
	it("names a refused connection the same way", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		render(
			<AuthBoundary>
				<p>Private workspace</p>
			</AuthBoundary>,
		);
		expect(
			await screen.findByRole("heading", { name: "Cannot reach your data." }),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"Cannot reach the Waypoint server. It may be down or restarting.",
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
});
