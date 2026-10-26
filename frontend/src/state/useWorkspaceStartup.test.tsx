import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { resetServerQueryCache } from "./serverQuery.ts";
import { resetWorkspaceStore, type RemoteApiClient } from "./workspaceStore.ts";
import { useWorkspaceStartup } from "./useWorkspaceStartup.ts";

function owner(id: string) {
	acceptResourceScope(
		{
			apiBaseUrl: "http://localhost",
			resource: { id, kind: "private", permissions: ["plan:read"] },
			subject: id,
		},
		suspendResourceScope(),
	);
}
function client() {
	return {
		getStatus: vi.fn(async () => ({ readOnly: false })),
		getModel: vi.fn(async () => ({ document: null, issues: [] })),
		listAmountPresets: vi.fn(async () => ({ presets: [] })),
	};
}
beforeEach(() => {
	owner("plans/a");
	resetWorkspaceStore();
	resetServerQueryCache();
});
afterEach(() => {
	cleanup();
	resetWorkspaceStore();
	resetServerQueryCache();
	suspendResourceScope();
});

it.each(["plans/a", "plans/b"])(
	"uses resource-scoped queries when %s replaces the old scope",
	async (id) => {
		const api = client();
		renderHook(() =>
			useWorkspaceStartup({ client: api as unknown as RemoteApiClient }),
		);
		await waitFor(() => expect(api.getModel).toHaveBeenCalledOnce());
		act(() => {
			suspendResourceScope();
		});
		act(() => {
			owner(id);
		});
		await waitFor(() =>
			expect(api.getModel).toHaveBeenCalledTimes(id === "plans/a" ? 1 : 2),
		);
	},
);

it("waits for the session boundary before fetching another owner's workspace", async () => {
	const api = client();
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
	const view = renderHook(
		() => useWorkspaceStartup({ client: api as unknown as RemoteApiClient }),
		{ wrapper },
	);
	await waitFor(() => expect(api.getModel).toHaveBeenCalledOnce());
	act(() => {
		owner("plans/b");
	});
	expect(api.getModel).toHaveBeenCalledOnce();
	id = "plans/b";
	view.rerender();
	await waitFor(() => expect(api.getModel).toHaveBeenCalledTimes(2));
});
