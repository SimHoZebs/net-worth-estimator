import { describe, expect, it } from "vitest";
import {
	CSV_MODEL_FILE_NAMES,
	CSV_MODEL_PUBLIC_PATH,
	CSV_MODEL_REPO_PATH,
} from "../types/model";

describe("core model terminology", () => {
	it("exposes canonical model constants", () => {
		expect(CSV_MODEL_REPO_PATH).toBe("public/configs");
		expect(CSV_MODEL_PUBLIC_PATH).toBe("/configs");
		expect(CSV_MODEL_FILE_NAMES).toEqual({
			accounts: "accounts.csv",
			checkpoints: "checkpoints.csv",
			postings: "postings.csv",
		});
	});
});
