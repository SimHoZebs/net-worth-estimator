import { describe, expect, it } from "vitest";
import type { AccountEditField } from "./useAccountEdit.ts";
import { isSyncedFieldLocked, syncedNameDraft } from "./useAccountEdit.ts";

describe("synced account name edit gating", () => {
	it("keeps the name locked on synced accounts unless the owner may rename it", () => {
		expect(isSyncedFieldLocked("name", false)).toBe(true);
		expect(isSyncedFieldLocked("name", true)).toBe(false);
		expect(isSyncedFieldLocked("balance", true)).toBe(true);
	});

	it("keeps kind, display basis and closing day editable on synced accounts", () => {
		const ownerFields: AccountEditField[] = ["kind", "display", "closingDay"];
		for (const field of ownerFields) {
			expect(isSyncedFieldLocked(field, false)).toBe(false);
		}
	});
});

describe("synced account name draft", () => {
	it("writes the stored name when the owner may not rename the account", () => {
		expect(syncedNameDraft(false, "Renamed", "Bank checking")).toEqual({
			name: "Bank checking",
			changed: false,
		});
	});

	it("reports a trimmed rename as changed", () => {
		expect(syncedNameDraft(true, "  My checking  ", "Bank checking")).toEqual({
			name: "My checking",
			changed: true,
		});
	});

	it("reports a cleared name as changed so submit can reject it", () => {
		expect(syncedNameDraft(true, "   ", "Bank checking")).toEqual({
			name: "",
			changed: true,
		});
	});

	it("does not report an unchanged name as a rename", () => {
		expect(syncedNameDraft(true, " Bank checking ", "Bank checking")).toEqual({
			name: "Bank checking",
			changed: false,
		});
	});
});
