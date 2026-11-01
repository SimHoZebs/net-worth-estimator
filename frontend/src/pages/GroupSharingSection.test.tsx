import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../mocks/fetch.ts";
import {
	ServerQueryWrapper,
	setupQueryScope,
	teardownQueryScope,
} from "../mocks/testScope.tsx";
import { GroupSharingSection } from "./GroupSharingSection.tsx";

const wrapper = ServerQueryWrapper;

function balanceRow(id: string, name: string) {
	return {
		id,
		name,
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 100,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-10-01",
		hasCheckpoint: false,
		syncOwned: false,
		readOnly: false,
	};
}

function stubSharing(options?: {
	policy?: Record<string, unknown> | null;
	grants?: Array<Record<string, unknown>>;
	preview?: Record<string, unknown> | null;
	failPreview?: boolean;
	failRevoke?: Array<string>;
}) {
	let policy: Record<string, unknown> | null = options?.policy ?? null;
	const grants = options?.grants ?? [];
	const requested: Array<{ method: string; path: string; body: unknown }> =
		[];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const raw = String(url);
			const path = raw.split("?")[0] ?? raw;
			const method = init?.method ?? "GET";
			let body: unknown;
			try {
				body = init?.body ? JSON.parse(String(init.body)) : undefined;
			} catch {
				body = undefined;
			}
			requested.push({ method, path, body });
			if (path.startsWith("/v1/accounts/balances"))
				return ok({
					accounts: [balanceRow("checking", "Checking")],
				});
			if (path === "/v1/shared/policies/g1") {
				if (method === "PUT") {
					const input = body as Record<string, unknown>;
					policy = {
						ownerUserId: "user:test",
						groupId: "g1",
						enabled: input.enabled,
						accountIds: input.accountIds,
						startDate: input.startDate || "2026-11-01",
						endDate: input.endDate || "",
						version: 1,
						updatedAt: 1,
					};
					return ok({ policy });
				}
				if (policy) return ok({ policy });
				return new Response("missing", { status: 404 });
			}
			if (path === "/v1/shared/policies/g1/preview") {
				if (options?.failPreview)
					return new Response("oops", { status: 500 });
				const input = body as Record<string, unknown>;
				return ok({
					preview:
						options?.preview ??
						({
							ownerUserId: "user:test",
							groupId: "g1",
							enabled: false,
							accountIds: input.accountIds,
							startDate: input.startDate,
							endDate: input.endDate || "",
							version: 0,
							eligiblePostings: 4,
							memberCount: 3,
						} satisfies Record<string, unknown>),
				});
			}
			if (path === "/v1/shared/grants") {
				if (method === "DELETE") {
					const input = body as Record<string, unknown>;
					if (
						(options?.failRevoke ?? []).includes(
							String(input.postingId),
						)
					)
						return new Response("gone", { status: 404 });
					const at = grants.findIndex(
						(grant) =>
							grant.postingId === input.postingId &&
							grant.audienceType === input.audienceType &&
							grant.audienceId === input.audienceId,
					);
					if (at >= 0) grants.splice(at, 1);
					return ok({ revoked: input.postingId });
				}
				return ok({ grants });
			}
			throw new Error(`unexpected request ${method} ${raw}`);
		}),
	);
	return { requested };
}

beforeEach(() => setupQueryScope());
afterEach(() => teardownQueryScope());

it("shows off-by-default sharing with no admin override", async () => {
	stubSharing();
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	expect(
		await screen.findByText("Automatic sharing is off. Only you can turn it on."),
	).toBeTruthy();
	expect(screen.getByText("Checking")).toBeTruthy();
});

it("previews counts with the historical warning before enabling", async () => {
	stubSharing();
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	await screen.findByText("Checking");
	fireEvent.click(screen.getByLabelText("Checking"));
	expect(
		await screen.findByText(/later bank imports can add older matching/),
	).toBeTruthy();
	expect(
		await screen.findByText(/4 transactions.*match this selection for 3 members/),
	).toBeTruthy();
	// Counts only: no amounts or payees leak into the preview.
	expect(screen.queryByText(/\$|Checking balance/)).toBeNull();

	fireEvent.click(screen.getByText("Turn on sharing"));
	await waitFor(() =>
		expect(
			screen.getByText("Automatic sharing is on for this group."),
		).toBeTruthy(),
	);
});

it("rejects enabling with no accounts selected", async () => {
	stubSharing();
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	await screen.findByText("Checking");
	expect(screen.getByText("Turn on sharing")).toHaveProperty(
		"disabled",
		true,
	);
});

it("shows a preview failure without blocking the form", async () => {
	stubSharing({ failPreview: true });
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	await screen.findByText("Checking");
	fireEvent.click(screen.getByLabelText("Checking"));
	expect(await screen.findByText(/Preview unavailable/)).toBeTruthy();
	expect(screen.getByText("Turn on sharing")).toHaveProperty(
		"disabled",
		false,
	);
});

it("stops sharing with everyone through the normal revocations", async () => {
	const { requested } = stubSharing({
		policy: {
			ownerUserId: "user:test",
			groupId: "g1",
			enabled: true,
			accountIds: ["checking"],
			startDate: "2026-01-01",
			endDate: "",
			version: 2,
			updatedAt: 1,
		},
		grants: [
			{
				ownerUserId: "user:test",
				postingId: "p1",
				audienceType: "group",
				audienceId: "g2",
				intent: "shared",
				createdAt: 1,
			},
		],
	});
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	await screen.findByText("Automatic sharing is on for this group.");
	fireEvent.click(screen.getByText("Stop sharing with everyone"));
	// Two-step confirmation so a stray click cannot revoke everything.
	fireEvent.click(
		screen.getByText("Confirm: stop sharing with everyone"),
	);
	await waitFor(() =>
		expect(
			screen.getByText("Automatic sharing is off. Only you can turn it on."),
		).toBeTruthy(),
	);
	const methods = requested
		.filter((entry) => entry.path === "/v1/shared/policies/g1")
		.map((entry) => entry.method);
	expect(methods).toContain("PUT");
	const revocations = requested.filter(
		(entry) =>
			entry.path === "/v1/shared/grants" && entry.method === "DELETE",
	);
	expect(revocations).toHaveLength(1);
	expect(revocations[0]?.body).toMatchObject({
		postingId: "p1",
		audienceType: "group",
		audienceId: "g2",
	});
});

it("tolerates an already-revoked grant when stopping", async () => {
	const { requested } = stubSharing({
		policy: {
			ownerUserId: "user:test",
			groupId: "g1",
			enabled: true,
			accountIds: ["checking"],
			startDate: "2026-01-01",
			endDate: "",
			version: 2,
			updatedAt: 1,
		},
		grants: [
			{
				ownerUserId: "user:test",
				postingId: "p1",
				audienceType: "group",
				audienceId: "g2",
				intent: "shared",
				createdAt: 1,
			},
			{
				ownerUserId: "user:test",
				postingId: "p2",
				audienceType: "group",
				audienceId: "g2",
				intent: "shared",
				createdAt: 1,
			},
		],
		failRevoke: ["p1"],
	});
	render(<GroupSharingSection groupId="g1" />, { wrapper });
	await screen.findByText("Automatic sharing is on for this group.");
	fireEvent.click(screen.getByText("Stop sharing with everyone"));
	fireEvent.click(
		screen.getByText("Confirm: stop sharing with everyone"),
	);
	// The missing grant counts as already removed; the stop still
	// revokes the remainder and turns the preference off.
	await waitFor(() =>
		expect(
			screen.getByText("Automatic sharing is off. Only you can turn it on."),
		).toBeTruthy(),
	);
	const revocations = requested.filter(
		(entry) =>
			entry.path === "/v1/shared/grants" && entry.method === "DELETE",
	);
	expect(revocations).toHaveLength(2);
});
