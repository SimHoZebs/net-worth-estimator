import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	getResourceScope,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import {
	loadRemoteState,
	persistRemoteState,
	readRemoteStateRaw,
	remoteStorageKey,
	REMOTE_STORAGE_KEY,
	type RemoteLocalState,
} from "./remoteStorage.ts";

function owner(id: string, apiBaseUrl = "https://plan.example") {
	return acceptResourceScope(
		{
			apiBaseUrl,
			resource: {
				id,
				kind: id === "plans/sample" ? "sample" : "private",
				permissions: ["plan:read"],
			},
			subject: id === "plans/sample" ? null : id,
		},
		suspendResourceScope(),
	)!;
}

const draftA: RemoteLocalState = {
	version: 1,
	draft: null,
	draftPresentation: null,
	baseRevision: "account-a-private-draft",
};
const draftB: RemoteLocalState = {
	...draftA,
	baseRevision: "account-b-private-draft",
};

beforeEach(() => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		clear: () => values.clear(),
	});
});
afterEach(() => {
	localStorage.clear();
	vi.unstubAllGlobals();
	suspendResourceScope();
});

describe("resource-scoped browser drafts", () => {
	it("never adopts or overwrites an unscoped draft", () => {
		const unscoped = JSON.stringify(draftA);
		localStorage.setItem(REMOTE_STORAGE_KEY, unscoped);
		owner("plans/private-b");
		expect(loadRemoteState()).toBeNull();
		expect(persistRemoteState(draftB)).toBeNull();
		expect(localStorage.getItem(REMOTE_STORAGE_KEY)).toBe(unscoped);
		expect(loadRemoteState()).toEqual(draftB);
	});

	it("keeps private accounts and sample drafts in separate namespaces", () => {
		owner("plans/private-a");
		const keyA = remoteStorageKey();
		expect(persistRemoteState(draftA)).toBeNull();
		owner("plans/private-b");
		expect(loadRemoteState()).toBeNull();
		expect(remoteStorageKey()).not.toBe(keyA);
		expect(persistRemoteState(draftB)).toBeNull();
		owner("plans/sample");
		expect(loadRemoteState()).toBeNull();
		owner("plans/private-a");
		expect(loadRemoteState()).toEqual(draftA);
		owner("plans/private-b");
		expect(loadRemoteState()).toEqual(draftB);
	});

	it("also separates the same resource ID on different API origins", () => {
		owner("plans/private-a");
		persistRemoteState(draftA);
		owner("plans/private-a", "https://other.example");
		expect(loadRemoteState()).toBeNull();
	});

	it("rejects reads and writes while session verification is pending", () => {
		owner("plans/private-a");
		persistRemoteState(draftA);
		suspendResourceScope();
		expect(remoteStorageKey()).toBeNull();
		expect(readRemoteStateRaw()).toBeInstanceOf(Error);
		expect(loadRemoteState()).toBeInstanceOf(Error);
		expect(persistRemoteState(draftB)).toBeInstanceOf(Error);
		owner("plans/private-a");
		expect(loadRemoteState()).toEqual(draftA);
	});

	it("rejects a captured stale scope even after the same resource is verified again", () => {
		const old = owner("plans/private-a");
		persistRemoteState(draftA);
		owner("plans/private-a");
		expect(getResourceScope()).not.toBe(old);
		expect(persistRemoteState(draftB, undefined, old)).toBeInstanceOf(Error);
		expect(loadRemoteState(old)).toBeInstanceOf(Error);
		expect(loadRemoteState()).toEqual(draftA);
	});

	it("retains compare-before-write protection within each resource", () => {
		owner("plans/private-a");
		persistRemoteState(draftA);
		const rawA = readRemoteStateRaw() as string;
		owner("plans/private-b");
		expect(persistRemoteState(draftB, rawA)).toBeInstanceOf(Error);
		expect(persistRemoteState(draftB, null)).toBeNull();
		expect(persistRemoteState(draftA, null)).toBeInstanceOf(Error);
		expect(loadRemoteState()).toEqual(draftB);
	});

	it("does not expose unscoped drafts to an authentication-disabled deployment", () => {
		localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(draftA));
		acceptResourceScope(
			{ apiBaseUrl: "https://legacy.example", resource: null, subject: null },
			suspendResourceScope(),
		);
		expect(loadRemoteState()).toBeNull();
		expect(persistRemoteState(draftB)).toBeNull();
		expect(loadRemoteState()).toEqual(draftB);
	});
});
