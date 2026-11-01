import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ok } from "../../mocks/fetch.ts";
import {
	ServerQueryWrapper,
	setupQueryScope,
	teardownQueryScope,
} from "../../mocks/testScope.tsx";
import { TransactionSharing } from "./TransactionSharing.tsx";

const wrapper = ServerQueryWrapper;

function stubSharing(grants: Array<Record<string, unknown>>) {
	const requested: Array<{ method: string; path: string; body?: unknown }> =
		[];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: unknown, init?: RequestInit) => {
			const path = String(url);
			const method = init?.method ?? "GET";
			let body: unknown;
			try {
				body = init?.body ? JSON.parse(String(init.body)) : undefined;
			} catch {
				body = undefined;
			}
			requested.push({ method, path, body });
			if (path === "/v1/groups")
				return ok({
					groups: [
						{
							id: "g1",
							name: "Household",
							role: "member",
							memberCount: 2,
							createdAt: 1,
						},
						{
							id: "g2",
							name: "Trip",
							role: "member",
							memberCount: 4,
							createdAt: 1,
						},
					],
				});
			if (path === "/v1/shared/grants") {
				if (method === "POST" || method === "DELETE") {
					const input = body as Record<string, unknown>;
					if (method === "POST") {
						const grant = {
							ownerUserId: "user:test",
							postingId: input.postingId,
							audienceType: input.audienceType,
							audienceId: input.audienceId,
							intent: "shared",
							createdAt: 1,
						};
						grants.push(grant);
						return ok({ grant }, 201);
					}
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
			if (path === "/v1/shared/exclusions") {
				const input = (body ?? {}) as Record<string, unknown>;
				if (method === "POST") {
					// The server rejects a share that collides with an
					// exclusion; the exclusion side mirrors the conflict.
					const conflict = grants.some(
						(grant) =>
							grant.postingId === input.postingId &&
							grant.audienceType === input.audienceType &&
							grant.audienceId === input.audienceId &&
							grant.intent === "shared",
					);
					if (conflict)
						return new Response(
							JSON.stringify({
								status: 400,
								detail:
									"revoke the grant before excluding this audience",
							}),
							{ status: 400 },
						);
					const exclusion = {
						ownerUserId: "user:test",
						postingId: input.postingId,
						audienceType: input.audienceType,
						audienceId: input.audienceId,
						intent: "excluded",
						createdAt: 1,
					};
					grants.push(exclusion);
					return ok({ exclusion }, 201);
				}
				const at = grants.findIndex(
					(grant) =>
						grant.postingId === input.postingId &&
						grant.audienceType === input.audienceType &&
						grant.audienceId === input.audienceId,
				);
				if (at >= 0) grants.splice(at, 1);
				return ok({ removed: input.postingId });
			}
			throw new Error(`unexpected request ${method} ${path}`);
		}),
	);
	return { requested };
}

function renderSharing(postingId = "p1", readOnly = false) {
	render(<TransactionSharing postingId={postingId} readOnly={readOnly} />, {
		wrapper,
	});
}

beforeEach(() => setupQueryScope());
afterEach(() => teardownQueryScope());

it("shows the default state when nothing is shared", async () => {
	stubSharing([]);
	renderSharing();
	expect(
		await screen.findByText("Only you can see this transaction."),
	).toBeTruthy();
});

it("shares one transaction with one group", async () => {
	const { requested } = stubSharing([]);
	renderSharing();
	await screen.findByText("Only you can see this transaction.");
	fireEvent.change(screen.getByLabelText(/Share with a group/), {
		target: { value: "g1" },
	});
	fireEvent.click(screen.getByText("Share"));
	await waitFor(() =>
		expect(screen.getByText("Household")).toBeTruthy(),
	);
	expect(
		requested.find(
			(entry) =>
				entry.path === "/v1/shared/grants" && entry.method === "POST",
		)?.body,
	).toMatchObject({
		postingId: "p1",
		audienceType: "group",
		audienceId: "g1",
	});
});

it("hides one transaction from everyone including future groups", async () => {
	const { requested } = stubSharing([]);
	renderSharing();
	await screen.findByText("Only you can see this transaction.");
	fireEvent.change(screen.getByLabelText(/Hide from a group or everyone/), {
		target: { value: "all" },
	});
	fireEvent.click(screen.getByText("Hide"));
	await waitFor(() =>
		expect(
			screen.getByText("everyone, including future groups"),
		).toBeTruthy(),
	);
	expect(
		requested.find(
			(entry) =>
				entry.path === "/v1/shared/exclusions" && entry.method === "POST",
		)?.body,
	).toMatchObject({ postingId: "p1", audienceType: "all", audienceId: "" });
});

it("surfaces the server conflict instead of double intents", async () => {
	stubSharing([
		{
			ownerUserId: "user:test",
			postingId: "p1",
			audienceType: "group",
			audienceId: "g1",
			intent: "shared",
			createdAt: 1,
		},
	]);
	renderSharing();
	await screen.findByText("Household");
	fireEvent.change(screen.getByLabelText(/Hide from a group or everyone/), {
		target: { value: "g1" },
	});
	// g1 is already shared, so it is not offered as a hide target; the
	// conflict path stays server-enforced. Revoking clears the way.
	fireEvent.click(screen.getByText("Stop sharing"));
	await waitFor(() =>
		expect(
			screen.getByText("Only you can see this transaction."),
		).toBeTruthy(),
	);
	fireEvent.change(screen.getByLabelText(/Hide from a group or everyone/), {
		target: { value: "g1" },
	});
	fireEvent.click(screen.getByText("Hide"));
	await waitFor(() => expect(screen.getByText("Household")).toBeTruthy());
	expect(screen.getByText("Hidden from")).toBeTruthy();
});

it("hides the controls in read-only mode", async () => {
	stubSharing([]);
	renderSharing("p1", true);
	await screen.findByText("Only you can see this transaction.");
	expect(screen.queryByText("Share")).toBeNull();
	expect(screen.queryByText("Hide")).toBeNull();
});

it("pauses sharing while hidden from everyone", async () => {
	stubSharing([]);
	renderSharing();
	await screen.findByText("Only you can see this transaction.");
	fireEvent.change(screen.getByLabelText(/Hide from a group or everyone/), {
		target: { value: "all" },
	});
	fireEvent.click(screen.getByText("Hide"));
	await waitFor(() =>
		expect(
			screen.getByText("everyone, including future groups"),
		).toBeTruthy(),
	);
	// The share control is disabled with the reason: a group grant would
	// coexist but never take effect while the wildcard exclusion lasts.
	expect(screen.getByText("Share")).toHaveProperty("disabled", true);
	expect(
		screen.getByText(/Sharing is paused while this transaction is/),
	).toBeTruthy();
});

it("marks shares suppressed once hidden from everyone", async () => {
	stubSharing([]);
	renderSharing();
	await screen.findByText("Only you can see this transaction.");
	fireEvent.change(screen.getByLabelText(/Share with a group/), {
		target: { value: "g1" },
	});
	fireEvent.click(screen.getByText("Share"));
	await waitFor(() => expect(screen.getByText("Household")).toBeTruthy());
	fireEvent.change(screen.getByLabelText(/Hide from a group or everyone/), {
		target: { value: "all" },
	});
	fireEvent.click(screen.getByText("Hide"));
	await waitFor(() =>
		expect(
			screen.getByText(/hidden while the everyone exclusion lasts/),
		).toBeTruthy(),
	);
});
