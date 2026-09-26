import { describe, expect, it, vi } from "vitest";
import {
	isFinancialModelDocument,
	MAX_IMPORT_BYTES,
	ModelImportError,
	parseModelDocument,
	readImportFile,
} from "./modelImport.ts";

const document = {
	sourcePath: "models/household",
	accounts: [{ id: "cash", label: "Cash", enabled: true }],
	checkpoints: [{ Date: "2026-01-01", AccountId: "cash", Balance: 100 }],
	postings: [{ id: "pay", label: "Pay", enabled: true }],
	evaluations: {
		financialIndependence: [],
		netWorthThreshold: [],
		postingFulfillment: [],
	},
};

describe("server model import parsing", () => {
	it("preserves the complete server document without applying display-plan defaults", () => {
		const input = { ...document, additionalServerField: { value: 42 } };
		expect(
			parseModelDocument({
				text: JSON.stringify(input),
				malformedMessage: "Invalid model JSON",
			}),
		).toEqual(input);
	});
	it.each([
		null,
		[],
		"model",
		{ accounts: [] },
		{ ...document, sourcePath: null },
		{ ...document, evaluations: {} },
		{
			...document,
			evaluations: { ...document.evaluations, postingFulfillment: null },
		},
		{ ...document, accounts: [null] },
		{ ...document, accounts: [{ id: "cash", label: "Cash" }] },
		{
			...document,
			checkpoints: [{ Date: "2026-01-01", AccountId: "cash", Balance: "100" }],
		},
		{ ...document, postings: [{ id: "pay", label: 1, enabled: true }] },
	])("rejects an unsafe preview envelope: %j", (value) => {
		expect(isFinancialModelDocument(value)).toBe(false);
		const result = parseModelDocument({
			text: JSON.stringify(value),
			malformedMessage: "Invalid model JSON",
		});
		expect(result).toBeInstanceOf(ModelImportError);
		expect(result).toHaveProperty(
			"message",
			"Choose a Waypoint server model JSON file with accounts, checkpoints, postings, and evaluations.",
		);
	});
	it("accepts empty tables for subsequent authoritative server validation", () => {
		expect(
			isFinancialModelDocument({
				...document,
				accounts: [],
				checkpoints: [],
				postings: [],
			}),
		).toBe(true);
	});
	it("leaves references and evaluation row validation to the server", () => {
		const input = {
			...document,
			checkpoints: [{ Date: "2026-01-01", AccountId: "missing", Balance: 100 }],
			evaluations: {
				...document.evaluations,
				netWorthThreshold: [{ id: "review-on-server" }],
			},
		};
		expect(
			parseModelDocument({
				text: JSON.stringify(input),
				malformedMessage: "Invalid model JSON",
			}),
		).toEqual(input);
	});
	it.each([
		"The selected model file is not valid JSON.",
		"The selected server model file is not valid JSON.",
	])("retains caller-specific malformed JSON copy", (malformedMessage) => {
		const result = parseModelDocument({ text: "{", malformedMessage });
		expect(result).toBeInstanceOf(ModelImportError);
		expect(result).toHaveProperty("message", malformedMessage);
		expect(result).toHaveProperty("cause", expect.any(SyntaxError));
	});
});

describe("import file reading", () => {
	it("rejects oversized files before reading them", async () => {
		const text = vi.fn().mockResolvedValue("{}");
		const result = await readImportFile({
			file: { size: MAX_IMPORT_BYTES + 1, text },
			oversizedMessage: "Choose a smaller model.",
		});
		expect(result).toBeInstanceOf(ModelImportError);
		expect(result).toHaveProperty("message", "Choose a smaller model.");
		expect(text).not.toHaveBeenCalled();
	});
	it("allows a file exactly at the size limit", async () => {
		const text = vi.fn().mockResolvedValue("model text");
		expect(
			await readImportFile({
				file: { size: MAX_IMPORT_BYTES, text },
				oversizedMessage: "Too large",
			}),
		).toBe("model text");
		expect(text).toHaveBeenCalledOnce();
	});
	it("distinguishes an unreadable file from malformed JSON and preserves its cause", async () => {
		const cause = new Error("Read failed");
		const result = await readImportFile({
			file: { size: 10, text: () => Promise.reject(cause) },
			oversizedMessage: "Too large",
		});
		expect(result).toBeInstanceOf(ModelImportError);
		expect(result).toHaveProperty(
			"message",
			"The selected file could not be read.",
		);
		expect(result).toHaveProperty("cause", cause);
	});
});
