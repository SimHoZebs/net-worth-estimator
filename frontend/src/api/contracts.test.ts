import { describe, expect, expectTypeOf, it } from "vitest";
import {
	NO_CEILING_SENTINEL,
	NO_FLOOR_SENTINEL,
	type AmountPreset,
	type BackendAccount,
	type BackendPlannedPurchase,
	type BackendSchedule,
	type BackendTransaction,
	type DeterministicProjectionRequest,
	type EvaluationResultEnvelope,
	type EvaluationTables,
	type FinancialModel,
	type FinancialModelResponse,
	type ModelOverrides,
	type ProjectionResult,
	type ProjectionRuntimeSettings,
	type SafeSpendingSettings,
	type ServerStatus,
} from "./contracts.ts";
import type {
	Account as GeneratedAccount,
	AmountPreset as GeneratedAmountPreset,
	EvaluationResultEnvelope as GeneratedEvaluationResultEnvelope,
	EvaluationTables as GeneratedEvaluationTables,
	FinancialModel as GeneratedFinancialModel,
	FinancialModelResponse as GeneratedFinancialModelResponse,
	ModelOverrides as GeneratedModelOverrides,
	PlannedPurchase as GeneratedPlannedPurchase,
	ProjectionRequestBody,
	ProjectionResult as GeneratedProjectionResult,
	ProjectionRuntimeSettings as GeneratedProjectionRuntimeSettings,
	SafeSpendingSettings as GeneratedSafeSpendingSettings,
	Schedule as GeneratedSchedule,
	StatusOutputBody,
	Transaction as GeneratedTransaction,
} from "./generated/model/index.ts";

describe("backend API contracts", () => {
	it("exposes finite account-bound sentinels for wire compatibility", () => {
		expect(NO_FLOOR_SENTINEL).toBe(-10_000_000_000_000);
		expect(NO_CEILING_SENTINEL).toBe(10_000_000_000_000);
	});
});

/** The client view may narrow values, but it must never drop or rename a
 * generated key: a snapshot change then fails this test at compile time. */
describe("generated payload key parity", () => {
	it("keeps the same keys as the generated model", () => {
		expectTypeOf<keyof FinancialModel>().toEqualTypeOf<
			keyof GeneratedFinancialModel
		>();
		expectTypeOf<keyof BackendAccount>().toEqualTypeOf<
			keyof GeneratedAccount
		>();
		expectTypeOf<keyof BackendTransaction>().toEqualTypeOf<
			keyof GeneratedTransaction
		>();
		expectTypeOf<keyof BackendSchedule>().toEqualTypeOf<
			keyof GeneratedSchedule
		>();
		expectTypeOf<keyof BackendPlannedPurchase>().toEqualTypeOf<
			keyof GeneratedPlannedPurchase
		>();
		expectTypeOf<keyof EvaluationTables>().toEqualTypeOf<
			keyof GeneratedEvaluationTables
		>();
		expectTypeOf<keyof EvaluationResultEnvelope>().toEqualTypeOf<
			keyof GeneratedEvaluationResultEnvelope
		>();
		expectTypeOf<keyof ProjectionResult>().toEqualTypeOf<
			keyof GeneratedProjectionResult
		>();
		expectTypeOf<keyof ModelOverrides>().toEqualTypeOf<
			keyof GeneratedModelOverrides
		>();
		expectTypeOf<keyof ProjectionRuntimeSettings>().toEqualTypeOf<
			keyof GeneratedProjectionRuntimeSettings
		>();
		expectTypeOf<keyof AmountPreset>().toEqualTypeOf<
			keyof GeneratedAmountPreset
		>();
		expectTypeOf<keyof SafeSpendingSettings>().toEqualTypeOf<
			keyof GeneratedSafeSpendingSettings
		>();
		expectTypeOf<keyof ServerStatus>().toEqualTypeOf<keyof StatusOutputBody>();
		expectTypeOf<keyof FinancialModelResponse>().toEqualTypeOf<
			keyof GeneratedFinancialModelResponse
		>();
		expectTypeOf<keyof DeterministicProjectionRequest>().toEqualTypeOf<
			keyof ProjectionRequestBody
		>();
	});
});
