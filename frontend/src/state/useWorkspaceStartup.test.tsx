import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { suspendAccountScope } from "../auth/resourceScope.ts";
import { acceptOwnerResource } from "../mocks/resource.ts";
import { stubTestServer } from "../mocks/waypointServer.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import { resetWorkspaceStore } from "./workspaceStore.ts";
import { useWorkspaceStartup } from "./useWorkspaceStartup.ts";

function owner(id: string) {
	acceptOwnerResource(id);
}

beforeEach(() => {
	owner("accounts/a");
	resetWorkspaceStore();
	resetServerQueryCache();
	vi.unstubAllGlobals();
});
afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendAccountScope();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

it.each(["accounts/a", "accounts/b"])(
	"uses resource-scoped queries when %s replaces the old scope",
	async (id) => {
		const server = stubTestServer();
		renderHook(() => useWorkspaceStartup());
		await waitFor(() => expect(server.modelFetches()).toHaveLength(1));
		act(() => {
			suspendAccountScope();
		});
		act(() => {
			owner(id);
		});
		await waitFor(() =>
			expect(server.modelFetches()).toHaveLength(id === "accounts/a" ? 1 : 2),
		);
	},
);

it("waits for the session boundary before fetching another owner's workspace", async () => {
	const server = stubTestServer();
	let id = "accounts/a";
	const wrapper = ({ children }: { children: ReactNode }) => (
		<SessionContext
			value={{
				session: {
					enabled: true,
					authenticated: true,
					allowed: true,
					resource: { id, kind: "private", permissions: ["account:read"] },
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
		owner("accounts/b");
	});
	expect(server.modelFetches()).toHaveLength(1);
	id = "accounts/b";
	view.rerender();
	await waitFor(() => expect(server.modelFetches()).toHaveLength(2));
});
