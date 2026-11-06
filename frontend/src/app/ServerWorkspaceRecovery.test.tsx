import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../mocks/workspace.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

beforeEach(acceptTestResource);

afterEach(() => {
	cleanup();
});

it("keeps account controls out of recovery while the model is empty", () => {
	setServerStatusFixture({
		readOnly: false,
		hasModel: false,
		syncConfigured: false,
		syncQuotaUsed: 0,
		syncQuotaLimit: 0,
	});
	setServerModelFixture(undefined, { model: null });
	const logout = vi.fn(async () => {});
	render(
		<SessionContext
			value={{
				session: {
					enabled: true,
					authenticated: true,
					allowed: true,
					resource: {
						id: `users/${"a".repeat(64)}`,
						permissions: ["user:read", "user:write"],
					},
					user: {
						subject: "new-owner",
						name: "New account owner",
					},
				},
				phase: "ready",
				error: "",
				refresh: vi.fn(async () => {}),
				logout,
				logoutPending: false,
			}}
		>
			<ServerWorkspaceRecovery />
		</SessionContext>,
	);
	expect(
		screen.getByRole("heading", { name: /No financial model/ }),
	).toBeTruthy();
	expect(
		screen
			.getByRole("button", { name: "Choose server model JSON" })
			.hasAttribute("disabled"),
	).toBe(false);
	expect(
		screen.getByRole("button", { name: "Retry server load" }),
	).toBeTruthy();
	// Account controls live in Configs → Account, so the recovery body stays
	// free of session actions; the shared layout owns navigation.
	expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
	expect(screen.queryByText("New account owner")).toBeNull();
	expect(logout).not.toHaveBeenCalled();
});
