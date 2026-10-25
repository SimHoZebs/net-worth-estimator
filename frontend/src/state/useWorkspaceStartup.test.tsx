import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import { SessionContext } from "../auth/sessionContext.ts";
import { useWorkspaceStartup } from "./useWorkspaceStartup.ts";

const actions = vi.hoisted(() => ({
	bindEngine: vi.fn(),
	bootWorkspace: vi.fn(),
	shutdownWorkspace: vi.fn(),
}));

vi.mock("./workspaceStore.ts", () => ({
	useWorkspaceStore: (selector: (state: typeof actions) => unknown) =>
		selector(actions),
}));

function owner(id: string) {
	return acceptResourceScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: { id, kind: "private", permissions: ["plan:read"] },
			subject: id,
		},
		suspendResourceScope(),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	owner("plans/a");
});
afterEach(() => {
	cleanup();
	suspendResourceScope();
});

it.each(["plans/a", "plans/b"])(
	"binds a fresh client when verified plan %s replaces the old scope",
	(id) => {
		renderHook(() => useWorkspaceStartup());
		const first = actions.bindEngine.mock.calls[0]![0];
		expect(actions.bootWorkspace).toHaveBeenCalledOnce();
		act(() => {
			suspendResourceScope();
		});
		expect(actions.shutdownWorkspace).toHaveBeenCalledOnce();
		expect(actions.bindEngine).toHaveBeenCalledOnce();
		expect(actions.bootWorkspace).toHaveBeenCalledOnce();
		act(() => {
			owner(id);
		});
		expect(actions.bindEngine).toHaveBeenCalledTimes(2);
		expect(actions.bindEngine.mock.calls[1]![0]).not.toBe(first);
		expect(actions.bootWorkspace).toHaveBeenCalledTimes(2);
	},
);

it("waits for the session boundary before it starts another owner's workspace", () => {
	let session = {
		enabled: true as const,
		authenticated: true,
		allowed: true,
		resource: {
			id: "plans/a",
			kind: "private" as const,
			permissions: ["plan:read"],
		},
	};
	const wrapper = ({ children }: { children: ReactNode }) => (
		<SessionContext
			value={{
				session,
				logout: async () => {},
				logoutPending: false,
				logoutError: "",
			}}
		>
			{children}
		</SessionContext>
	);
	const view = renderHook(() => useWorkspaceStartup(), { wrapper });
	act(() => {
		owner("plans/b");
	});
	expect(actions.bindEngine).toHaveBeenCalledOnce();
	expect(actions.bootWorkspace).toHaveBeenCalledOnce();
	session = { ...session, resource: { ...session.resource, id: "plans/b" } };
	view.rerender();
	expect(actions.bindEngine).toHaveBeenCalledTimes(2);
	expect(actions.bootWorkspace).toHaveBeenCalledTimes(2);
});
