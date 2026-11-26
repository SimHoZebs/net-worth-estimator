// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import { resetServerQueryCache, serverQueryClient } from "./serverQuery.ts";
import { deleteSavedAccount } from "./accountWrites.ts";

const mocks = vi.hoisted(() => ({
	deleteAccount: vi.fn(),
	reloadWorkspace: vi.fn(),
	refreshPaymentTerms: vi.fn(),
	refreshSafeSpendingSettings: vi.fn(),
	refreshPins: vi.fn(),
}));

vi.mock("@/api/generated/endpoints.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/api/generated/endpoints.ts")>()),
	deleteAccount: mocks.deleteAccount,
}));
vi.mock("./workspaceResources.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./workspaceResources.ts")>()),
	reloadWorkspace: mocks.reloadWorkspace,
	refreshPaymentTerms: mocks.refreshPaymentTerms,
	workspaceIsBusy: vi.fn(() => false),
}));
vi.mock("./useSafeSpendingSettings.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./useSafeSpendingSettings.ts")>()),
	refreshSafeSpendingSettings: mocks.refreshSafeSpendingSettings,
}));
vi.mock("./pinnedEvaluations.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("./pinnedEvaluations.ts")>()),
	refreshPins: mocks.refreshPins,
}));

function owner() {
	acceptUserScope(
		{
			apiBaseUrl: canonicalApiBaseUrl(""),
			resource: {
				id: "users/a",
				permissions: ["user:read", "user:write"],
			},
			subject: "users/a",
		},
		suspendUserScope(),
	);
}

beforeEach(() => {
	owner();
	resetServerQueryCache();
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.reloadWorkspace.mockResolvedValue(true);
	mocks.refreshPaymentTerms.mockResolvedValue(undefined);
	mocks.refreshSafeSpendingSettings.mockResolvedValue(undefined);
	mocks.refreshPins.mockResolvedValue(undefined);
});

afterEach(() => {
	resetServerQueryCache();
	suspendUserScope();
	vi.restoreAllMocks();
});

it("deletes once and reloads every dependent workspace surface", async () => {
	mocks.deleteAccount.mockResolvedValue({
		data: { saved: true, issues: [], revision: '"next"' },
	});
	const invalidate = vi.spyOn(serverQueryClient(), "invalidateQueries");
	const refetch = vi.spyOn(serverQueryClient(), "refetchQueries");
	await expect(deleteSavedAccount("cash")).resolves.toEqual({
		persisted: true,
		refreshed: true,
	});
	expect(mocks.deleteAccount).toHaveBeenCalledTimes(1);
	expect(mocks.reloadWorkspace).toHaveBeenCalledWith({ waitForWrites: false });
	expect(mocks.refreshPaymentTerms).toHaveBeenCalledTimes(1);
	expect(mocks.refreshSafeSpendingSettings).toHaveBeenCalledTimes(1);
	expect(mocks.refreshPins).toHaveBeenCalledWith(true);
	expect(invalidate).toHaveBeenCalledWith(
		expect.objectContaining({ refetchType: "none" }),
	);
	expect(refetch).not.toHaveBeenCalled();
});

it("keeps a server rejection unpersisted and reloads authoritative state", async () => {
	mocks.deleteAccount.mockResolvedValue({
		data: {
			saved: false,
			issues: [{ severity: "error", message: "The account is still syncing." }],
		},
	});
	const rejected = vi.fn();
	await expect(deleteSavedAccount("cash", rejected)).resolves.toEqual({
		persisted: false,
		refreshed: false,
	});
	expect(rejected).toHaveBeenCalledWith("The account is still syncing.");
	expect(mocks.reloadWorkspace).toHaveBeenCalledTimes(1);
});

it("reports persistence when only the post-delete reload fails", async () => {
	mocks.deleteAccount.mockResolvedValue({ data: { saved: true, issues: [] } });
	mocks.reloadWorkspace.mockResolvedValue(false);
	await expect(deleteSavedAccount("cash")).resolves.toEqual({
		persisted: true,
		refreshed: false,
	});
});

it("normalizes an empty delete response as a successful save", async () => {
	mocks.deleteAccount.mockResolvedValue({ data: undefined });
	await expect(deleteSavedAccount("cash")).resolves.toEqual({
		persisted: true,
		refreshed: true,
	});
});
