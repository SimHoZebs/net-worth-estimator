import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { stubTestServer } from "../test/waypointServer.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import { resetWorkspaceStore } from "./workspaceStore.ts";
import { useWorkspaceStartup } from "./useWorkspaceStartup.ts";

function owner(id: string) {
	acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id, kind: "private", permissions: ["plan:read"] },
			subject: id,
		},
		suspendResourceScope(),
	);
}

beforeEach(() => {
	owner("plans/a");
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});
afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendResourceScope();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it.each(["plans/a", "plans/b"])(
	"uses resource-scoped queries when %s replaces the old scope",
	async (id) => {
		const server = stubTestServer();
		renderHook(() => useWorkspaceStartup());
		await waitFor(() => expect(server.modelFetches()).toHaveLength(1));
		act(() => {
			suspendResourceScope();
		});
		act(() => {
			owner(id);
		});
		await waitFor(() =>
			expect(server.modelFetches()).toHaveLength(id === "plans/a" ? 1 : 2),
		);
	},
);

it("waits for the session boundary before fetching another owner's workspace", async () => {
	const server = stubTestServer();
	let id = "plans/a";
	const wrapper = ({ children }: { children: ReactNode }) => (
		<SessionContext
			value={{
				session: {
					enabled: true,
					authenticated: true,
					allowed: true,
					resource: { id, kind: "private", permissions: ["plan:read"] },
				},
				logout: async () => {},
				logoutPending: false,
			}}
		>
			{children}
		</SessionContext>
	);
	const view = renderHook(() => useWorkspaceStartup(), { wrapper });
	await waitFor(() => expect(server.modelFetches()).toHaveLength(1));
	act(() => {
		owner("plans/b");
	});
	expect(server.modelFetches()).toHaveLength(1);
	id = "plans/b";
	view.rerender();
	await waitFor(() => expect(server.modelFetches()).toHaveLength(2));
});
