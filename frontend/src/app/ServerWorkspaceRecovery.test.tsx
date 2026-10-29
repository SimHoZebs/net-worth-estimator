import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { acceptTestResource } from "../mocks/resource.ts";
import {
	setServerModelFixture,
	setServerStatusFixture,
} from "../mocks/workspace.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { resetWorkspaceStore } from "../state/workspaceStore.ts";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));

beforeEach(acceptTestResource);

vi.mock("../workspace/WorkspaceLayout.tsx", () => ({
	WorkspaceLayout: ({
		navigation,
		children,
	}: {
		navigation: (close: () => void) => ReactNode;
		children: ReactNode;
	}) => (
		<>
			<aside>{navigation(() => {})}</aside>
			<main>{children}</main>
		</>
	),
}));

afterEach(() => {
	cleanup();
	resetWorkspaceStore();
});

it("keeps navigation usable without account controls when the private plan is empty", () => {
	setServerStatusFixture({ readOnly: false });
	setServerModelFixture(undefined, { document: null, conversion: null });
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
						kind: "private",
						permissions: ["user:read", "user:write"],
					},
					user: {
						subject: "new-owner",
						name: "New account owner",
					},
				},
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
	// Account controls live in Configs → Account, so the recovery sidebar
	// stays navigation-only.
	expect(
		screen.getByRole("navigation", {
			name: "Main navigation",
		}),
	).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
	expect(screen.queryByText("New account owner")).toBeNull();
	expect(logout).not.toHaveBeenCalled();
});
