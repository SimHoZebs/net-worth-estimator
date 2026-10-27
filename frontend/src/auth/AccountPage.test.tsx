// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "./AccountPage.tsx";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { resetNotifications } from "../state/notifications.ts";
import { redirectToSignIn } from "./navigation.ts";
import { SessionContext, type Session } from "./sessionContext.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import { acceptResourceScope, suspendResourceScope } from "./resourceScope.ts";
import { sessionScopeInput } from "./sessionDiscovery.ts";

vi.mock("./navigation.ts", () => ({ redirectToSignIn: vi.fn() }));

const session: Session = {
	enabled: true,
	authenticated: true,
	allowed: true,
	accountURL: "https://identity.example/account",
	resource: {
		id: `plans/${"a".repeat(64)}`,
		kind: "private",
		permissions: ["plan:read", "plan:write"],
	},
	user: { subject: "subject-1", name: "Sam Lee" },
};

function renderPage(
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	next: Session = session,
) {
	vi.stubGlobal("fetch", vi.fn(fetcher));
	acceptResourceScope(sessionScopeInput(next), suspendResourceScope());
	return render(
		<SessionContext
			value={{
				session: next,
				logout: vi.fn(),
				logoutPending: false,
			}}
		>
			<AccountPage />
			<NotificationCenter />
		</SessionContext>,
	);
}

function json(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	cleanup();
	resetServerQueryCache();
	suspendResourceScope();
	resetNotifications();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("account page", () => {
	it("retires an unsaved display name when the loaded profile changes", async () => {
		let displayName = "Sam Lee";
		renderPage(async (input) =>
			String(input).endsWith("/v1/auth/profile")
				? json({ owner: "waypoint", name: "editor", displayName, avatar: "" })
				: json({ sessions: [] }),
		);
		await screen.findByText("Signed in as editor.");
		fireEvent.change(screen.getByLabelText("Display name"), {
			target: { value: "Unsaved name" },
		});
		await act(async () => {
			await serverQueryClient().refetchQueries({ queryKey: ["account"] });
		});
		expect(screen.getByLabelText<HTMLInputElement>("Display name").value).toBe(
			"Unsaved name",
		);
		displayName = "Fresh server name";
		await act(async () => {
			await serverQueryClient().refetchQueries({ queryKey: ["account"] });
		});
		await waitFor(() =>
			expect(
				screen.getByLabelText<HTMLInputElement>("Display name").value,
			).toBe("Fresh server name"),
		);
	});

	it("does not fetch account details after the resource scope is suspended", async () => {
		const fetcher = vi.fn(async (input: RequestInfo | URL) =>
			String(input).endsWith("/v1/auth/profile")
				? json({
						owner: "waypoint",
						name: "editor",
						displayName: "Sam Lee",
						avatar: "",
					})
				: json({ sessions: [] }),
		);
		renderPage(fetcher);
		await screen.findByText("Signed in as editor.");
		expect(fetcher).toHaveBeenCalledTimes(2);
		act(() => {
			suspendResourceScope();
		});
		await waitFor(() =>
			expect(screen.queryByLabelText("Display name")).toBeNull(),
		);
		expect(serverQueryClient().isFetching({ queryKey: ["account"] })).toBe(0);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it("loads the profile and sessions and links passkeys to the provider", async () => {
		renderPage(async (input) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions"))
				return json({
					sessions: [
						{
							id: "current",
							current: true,
							loginStartedAt: new Date().toISOString(),
							expiresAt: new Date().toISOString(),
						},
						{
							id: "other",
							current: false,
							loginStartedAt: new Date().toISOString(),
							expiresAt: new Date().toISOString(),
						},
					],
				});
			throw new Error(`unexpected ${url}`);
		});
		await screen.findByText("Signed in as editor.");
		expect(
			screen
				.getByRole("link", { name: "Manage passkeys on the provider page" })
				.getAttribute("href"),
		).toBe("https://identity.example/account");
		expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
	});

	it("saves the display name through the proxy", async () => {
		const seen: string[] = [];
		renderPage(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile") && init?.method === "GET")
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
			if (url.endsWith("/v1/auth/profile") && init?.method === "PATCH") {
				seen.push(String(init.body));
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Samuel Lee",
					avatar: "",
				});
			}
			throw new Error(`unexpected ${url} ${init?.method}`);
		});
		await screen.findByText("Signed in as editor.");
		fireEvent.change(screen.getByLabelText("Display name"), {
			target: { value: "Samuel Lee" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save display name" }));
		await waitFor(() => expect(seen.length).toBe(1));
		expect(seen[0]).toContain("Samuel Lee");
		await screen.findByText("Display name updated.");
	});

	it("revokes another session through the proxy", async () => {
		const revoked: string[] = [];
		renderPage(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions") && init?.method === "GET")
				return json({
					sessions: [
						{
							id: "other",
							current: false,
							loginStartedAt: new Date().toISOString(),
							expiresAt: new Date().toISOString(),
						},
					],
				});
			if (url.includes("/v1/auth/sessions") && init?.method === "DELETE") {
				revoked.push(url);
				return json({ revoked: true });
			}
			throw new Error(`unexpected ${url} ${init?.method}`);
		});
		await screen.findByRole("button", { name: "Revoke" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
		await waitFor(() => expect(revoked.length).toBe(1));
		expect(revoked[0]).toContain("other");
	});

	it("signs in again after a successful password change", async () => {
		renderPage(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
			if (url.endsWith("/v1/auth/change-password"))
				return json({ reauth: true });
			throw new Error(`unexpected ${url} ${init?.method}`);
		});
		await screen.findByText("Signed in as editor.");
		fireEvent.change(screen.getByLabelText("Current password"), {
			target: { value: "old-secret" },
		});
		fireEvent.change(screen.getByLabelText("New password"), {
			target: { value: "new-secret-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Change password" }));
		await waitFor(() => expect(redirectToSignIn).toHaveBeenCalledTimes(1));
	});

	it("shows the provider password detail without signing out on rejection", async () => {
		renderPage(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
			if (url.endsWith("/v1/auth/change-password"))
				return json(
					{
						status: 400,
						title: "Bad Request",
						detail: "Password is too common.",
					},
					400,
				);
			throw new Error(`unexpected ${url} ${init?.method}`);
		});
		await screen.findByText("Signed in as editor.");
		fireEvent.change(screen.getByLabelText("Current password"), {
			target: { value: "old-secret" },
		});
		fireEvent.change(screen.getByLabelText("New password"), {
			target: { value: "password" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Change password" }));
		await screen.findByText("Password is too common.");
		expect(redirectToSignIn).not.toHaveBeenCalled();
	});

	it("retries loading instead of rendering empty forms", async () => {
		let attempts = 0;
		renderPage(async (input) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile")) {
				attempts += 1;
				if (attempts === 1) return json({}, 503);
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			}
			if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
			throw new Error(`unexpected ${url}`);
		});
		await screen.findByText("Account details could not be loaded.");
		expect(screen.queryByLabelText("Display name")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("Signed in as editor.");
		expect(screen.getByLabelText("Display name")).toBeTruthy();
		// The reload clears the floating load failure.
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("explains unavailable passkey management without a provider link", async () => {
		renderPage(
			async (input) => {
				const url = String(input);
				if (url.endsWith("/v1/auth/profile"))
					return json({
						owner: "waypoint",
						name: "editor",
						displayName: "Sam Lee",
						avatar: "",
					});
				if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
				throw new Error(`unexpected ${url}`);
			},
			{ ...session, accountURL: undefined },
		);
		await screen.findByText("Signed in as editor.");
		expect(
			screen.getByText(/Provider passkey management is unavailable/),
		).toBeTruthy();
		expect(
			screen.queryByRole("link", {
				name: "Manage passkeys on the provider page",
			}),
		).toBeNull();
	});

	it("states empty sessions instead of an empty list", async () => {
		renderPage(async (input) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions")) return json({ sessions: [] });
			throw new Error(`unexpected ${url}`);
		});
		await screen.findByText("No other signed-in devices.");
		expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
	});

	it("keeps the revoked notice when the session list refresh fails", async () => {
		let lists = 0;
		renderPage(async (input, init) => {
			const url = String(input);
			if (url.endsWith("/v1/auth/profile"))
				return json({
					owner: "waypoint",
					name: "editor",
					displayName: "Sam Lee",
					avatar: "",
				});
			if (url.endsWith("/v1/auth/sessions") && init?.method === "GET") {
				lists += 1;
				if (lists > 1) return json({}, 503);
				return json({
					sessions: [
						{
							id: "other",
							current: false,
							loginStartedAt: new Date().toISOString(),
							expiresAt: new Date().toISOString(),
						},
					],
				});
			}
			if (url.includes("/v1/auth/sessions") && init?.method === "DELETE")
				return json({ revoked: true });
			throw new Error(`unexpected ${url} ${init?.method}`);
		});
		await screen.findByRole("button", { name: "Revoke" });
		fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
		await screen.findByText("Session revoked.");
		await screen.findByText("The session list is unavailable.");
		expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
	});
});
