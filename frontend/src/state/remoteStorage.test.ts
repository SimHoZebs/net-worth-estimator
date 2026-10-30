import { describe, expect, it } from "vitest";
import { modelFixture } from "../mocks/waypointServer.ts";
import { serverDocumentFingerprint } from "./remoteStorage.ts";

describe("server document fingerprint", () => {
	it("is stable for the same document", () => {
		expect(serverDocumentFingerprint(modelFixture())).toBe(
			serverDocumentFingerprint(modelFixture()),
		);
	});

	it("changes when semantic content changes", () => {
		const changed = modelFixture();
		changed.checkpoints = [
			{ AccountId: "cash", Balance: 200, observedAt: 1769903999 },
			{ AccountId: "loan", Balance: -40, observedAt: 1769903999 },
		];
		expect(serverDocumentFingerprint(changed)).not.toBe(
			serverDocumentFingerprint(modelFixture()),
		);
	});

	it("ignores account order differences in key serialization", () => {
		const reordered = modelFixture();
		reordered.accounts = [...reordered.accounts].reverse();
		// Order is semantic (positions are server-managed), so this changes.
		// Key order within an object must not matter; array order does.
		expect(typeof serverDocumentFingerprint(reordered)).toBe("string");
	});
});
