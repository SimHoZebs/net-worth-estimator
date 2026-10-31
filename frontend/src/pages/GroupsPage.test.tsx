import { QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { suspendUserScope } from "../auth/resourceScope.ts";
import { ok } from "../mocks/fetch.ts";
import { acceptTestResource } from "../mocks/resource.ts";
import {
	resetServerQueryCache,
	serverQueryClient,
} from "../state/serverQuery.ts";
import type { GroupRole } from "./groupsApi.ts";
import { GroupsPage } from "./GroupsPage.tsx";

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={serverQueryClient()}>
			{children}
		</QueryClientProvider>
	);
}

function stubGroups(
	groups: Array<{
		id: string;
		name: string;
		role: GroupRole;
		memberCount?: number;
	}>,
	detail?: {
		members?: Array<{ accountId: string; role: GroupRole }>;
		invites?: Array<{ id: string; usedCount?: number; maxUses?: number }>;
		failDetail?: boolean;
		failInvites?: boolean;
		role?: GroupRole;
	},
) {
	const requested: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown) => {
			const path = String(url);
			requested.push(path);
			if (path === "/v1/groups")
				return ok({
					groups: groups.map((item) => ({
						id: item.id,
						name: item.name,
						role: item.role,
						memberCount: item.memberCount ?? 1,
						createdAt: 1,
					})),
				});
			const invites = path.match(/^\/v1\/groups\/([^/]+)\/invites$/);
			if (invites) {
				if (detail?.failInvites) return new Response("oops", { status: 500 });
				return ok({
					invites: (detail?.invites ?? []).map((invite) => ({
						groupId: invites[1],
						expiresAt: 2,
						maxUses: invite.maxUses ?? 5,
						usedCount: invite.usedCount ?? 0,
						createdAt: 1,
						id: invite.id,
					})),
				});
			}
			const single = path.match(/^\/v1\/groups\/([^/]+)$/);
			if (single) {
				const found = groups.find((item) => item.id === single[1]);
				if (detail?.failDetail || !found)
					return new Response("oops", { status: 500 });
				return ok({
					group: {
						id: found.id,
						name: found.name,
						role: detail?.role ?? found.role,
						memberCount: found.memberCount ?? 1,
						createdAt: 1,
					},
					members: (detail?.members ?? []).map((member) => ({
						...member,
						displayName: member.accountId,
						joinedAt: 1,
					})),
				});
			}
			throw new Error(`unexpected request ${path}`);
		}),
	);
	return requested;
}

beforeEach(() => {
	resetServerQueryCache();
	acceptTestResource();
	window.location.hash = "#groups";
});

afterEach(() => {
	cleanup();
	suspendUserScope();
	resetServerQueryCache();
	vi.unstubAllGlobals();
	window.location.hash = "";
});

it("shows a loading state then the group list on mount", async () => {
	stubGroups([{ id: "g1", name: "Household", role: "owner" }]);
	render(<GroupsPage />, { wrapper });
	expect(screen.getByText("Loading groups…")).toBeTruthy();
	await waitFor(() => expect(screen.getByText("Household")).toBeTruthy());
	expect(screen.getByRole("button", { name: "Create group" })).toBeTruthy();
});

it("shows the empty state when there are no groups", async () => {
	stubGroups([]);
	render(<GroupsPage />, { wrapper });
	await waitFor(() => expect(screen.getByText("No groups yet")).toBeTruthy());
});

it("shows the list error with a retry action", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("oops", { status: 500 })),
	);
	render(<GroupsPage />, { wrapper });
	await waitFor(() =>
		expect(screen.getByText("Groups could not be loaded.")).toBeTruthy(),
	);
	expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

it("shows group detail with members and invites for an owner", async () => {
	const requested = stubGroups(
		[{ id: "g1", name: "Household", role: "owner", memberCount: 2 }],
		{
			members: [
				{ accountId: "alice", role: "owner" },
				{ accountId: "bob", role: "member" },
			],
			invites: [{ id: "i1", usedCount: 1 }],
		},
	);
	window.location.hash = "#groups/g1";
	render(<GroupsPage />, { wrapper });
	await waitFor(() =>
		expect(screen.getByRole("heading", { name: "Household" })).toBeTruthy(),
	);
	expect(screen.getByText(/alice/)).toBeTruthy();
	expect(screen.getByRole("button", { name: "New invite code" })).toBeTruthy();
	expect(await screen.findByText("Uses 1/5")).toBeTruthy();
	expect(requested).toContain("/v1/groups/g1/invites");
});

it("hides invites for a member without fetching them", async () => {
	const requested = stubGroups(
		[{ id: "g1", name: "Household", role: "member", memberCount: 1 }],
		{ members: [{ accountId: "alice", role: "member" }] },
	);
	window.location.hash = "#groups/g1";
	render(<GroupsPage />, { wrapper });
	await waitFor(() =>
		expect(screen.getByRole("heading", { name: "Household" })).toBeTruthy(),
	);
	expect(screen.queryByRole("button", { name: "New invite code" })).toBeNull();
	expect(
		requested.filter((path) => path === "/v1/groups/g1/invites"),
	).toHaveLength(0);
});

it("shows the detail error when the group cannot load", async () => {
	stubGroups([{ id: "g1", name: "Household", role: "owner" }], {
		failDetail: true,
	});
	window.location.hash = "#groups/g1";
	render(<GroupsPage />, { wrapper });
	await waitFor(() =>
		expect(screen.getByText("Group could not be loaded.")).toBeTruthy(),
	);
});

it("shows an invite error with explicit retry without hiding the loaded group", async () => {
	const detail = {
		members: [{ accountId: "alice", role: "owner" as const }],
		invites: [{ id: "i1", usedCount: 1 }],
		failInvites: true,
	};
	stubGroups([{ id: "g1", name: "Household", role: "owner" }], detail);
	window.location.hash = "#groups/g1";
	render(<GroupsPage />, { wrapper });
	expect(await screen.findByText("Invites could not be loaded.")).toBeTruthy();
	expect(screen.getByText(/alice/)).toBeTruthy();
	expect(screen.getByRole("heading", { name: "Household" })).toBeTruthy();
	detail.failInvites = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry invites" }));
	expect(await screen.findByText("Uses 1/5")).toBeTruthy();
	expect(screen.queryByText("Invites could not be loaded.")).toBeNull();
});

it("uses the confirmed detail role, not an old list role, to request invites", async () => {
	const requested = stubGroups(
		[{ id: "g1", name: "Household", role: "owner" }],
		{
			role: "member",
			members: [{ accountId: "alice", role: "member" }],
		},
	);
	window.location.hash = "#groups/g1";
	render(<GroupsPage />, { wrapper });
	await screen.findByText(/alice/);
	expect(requested).not.toContain("/v1/groups/g1/invites");
});
