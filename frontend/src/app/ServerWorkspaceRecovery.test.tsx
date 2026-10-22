import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionContext } from "../auth/sessionContext.ts";
import {
	resetWorkspaceStore,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

vi.mock("../components/ThemeToggle.tsx", () => ({ ThemeToggle: () => null }));

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

it("keeps account controls above navigation when the private plan is empty", () => {
	useWorkspaceStore.setState({
		status: { readOnly: false, authEnabled: false },
		serverDocument: null,
		error: "no financial model",
	});
	const logout = vi.fn(async () => {});
	render(
		<SessionContext
			value={{
				session: {
					enabled: true,
					authenticated: true,
					allowed: true,
					user: {
						subject: "new-owner",
						name: "New account owner",
						role: "editor",
					},
				},
				logout,
				logoutPending: false,
				logoutError: "",
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
	const controls = screen.getByRole("button", { name: "Sign out" });
	const navigation = screen.getByRole("navigation", {
		name: "Main navigation",
	});
	expect(controls.closest("aside")).toBeTruthy();
	expect(
		controls.compareDocumentPosition(navigation) &
			Node.DOCUMENT_POSITION_FOLLOWING,
	).toBeTruthy();
	fireEvent.click(controls);
	expect(logout).toHaveBeenCalledOnce();
});
