import { describe, expect, it } from "vitest";
import {
	isHistoricalMovement,
	netWorth,
	visibleAccounts,
	visibleMovements,
} from "../domain/model.ts";
import {
	backendToDisplayPlan,
	displayPlanToBackendDocument,
} from "./adapter.ts";
import type { FinancialModelDocument, ProjectionResult } from "./contracts.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";

function documentFixture(): FinancialModelDocument {
	return {
		sourcePath: "/configs/household.json",
		accounts: [
			{
				id: "cash",
				name: "Cash",
				kind: "cash",
				minBalance: NO_FLOOR_SENTINEL,
				maxBalance: NO_CEILING_SENTINEL,
				color: null,
				enabled: true,
			},
			{
				id: "loan",
				name: "Loan",
				kind: "debt",
				minBalance: null,
				maxBalance: null,
				color: null,
				enabled: true,
			},
		],
		checkpoints: [
			{ Date: "2026-01-31", AccountId: "cash", Balance: 100 },
			{ Date: "2026-03-01", AccountId: "cash", Balance: 999 },
			{ Date: "2026-01-31", AccountId: "loan", Balance: -40 },
		],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "target",
					name: "Reach target",
					enabled: true,
					config: { target: 500 },
				},
			],
			accountBalance: [],
			postingFulfillment: [],
			cycleFulfillment: [],
		},
		postings: [
			{
				id: "salary",
				name: "Salary",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: {
					resolver: "expression",
					config: { expression: "250" },
					inputs: {},
				},
				frequency: "monthly",
				annualRate: 0,
				annualGrowthRate: 0.02,
				volatility: 0.1,
				startDate: "2026-02-05",
				endDate: null,
				annualCap: null,
				priority: 3,
				enabled: true,
				source: "model",
			},
		],
	};
}

function projectionFixture(): ProjectionResult {
	return {
		timeline: { rows: [] },
		accountSummaries: [],
		totals: {
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
		milestones: {
			latestHistoricalDate: "2026-01-31",
			projectionStartDate: "2026-02-01",
		},
		summary: { currentNetWorth: 60, finalNetWorth: 60 },
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
			cycleFulfillment: [],
		},
		movementEvents: [],
	};
}

describe("backend and display plan adapter", () => {
	it("uses the latest checkpoint at or before projection start and maps bounds, postings, and evaluations", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: true },
			projection: projectionFixture(),
		});

		expect(conversion.plan.startDate).toBe("2026-02-01");
		expect(conversion.plan.accounts[0]?.balance).toBe(100);
		expect(conversion.plan.accounts[0]?.observedOn).toBe("2026-01-31");
		expect(conversion.plan.accounts[0]?.minBalance).toBe(0);
		expect(conversion.plan.accounts[0]?.maxBalance).toBeNull();
		expect(conversion.plan.accounts[1]?.kind).toBe("debt");
		expect(conversion.plan.movements[0]).toMatchObject({
			amount: 250,
			fromId: null,
			toId: "cash",
			frequency: "monthly",
			annualIncrease: 2,
		});
		expect(conversion.plan.evaluations).toEqual([
			{
				id: "target",
				name: "Reach target",
				kind: "net-worth",
				target: 500,
				accountId: null,
				enabled: true,
			},
		]);
		expect(conversion.report.provisionalFields).toContain(
			"accounts.0.minBalance",
		);
		expect(conversion.report.provisionalFields).toContain(
			"movements.0.metadata",
		);
	});

	it("carries account colors to the display plan and back", () => {
		const document = documentFixture();
		document.accounts[0]!.color = "#4287f5";
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(conversion.plan.accounts[0]?.color).toBe("#4287f5");
		expect(conversion.plan.accounts[1]?.color).toBeNull();

		const reverse = displayPlanToBackendDocument(conversion.plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(reverse.document.accounts[0]?.color).toBe("#4287f5");
		expect(reverse.document.accounts[1]?.color).toBeNull();
	});

	// A one-time movement dated at or before the projection start is historical
	// whoever authored it; a recurring rule is a projection, not a past event.
	// Nothing is stored: the display plan is judged by frequency and date.
	it("classifies a one-time movement before the projection start as historical", () => {
		const startDate = "2026-02-01";
		const past = documentFixture();
		past.postings[0] = {
			...past.postings[0]!,
			frequency: "once",
			startDate: "2026-01-01",
			source: "model",
		};
		const pastConversion = backendToDisplayPlan({
			document: past,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate,
		});
		// Nothing is stored: the plan holds frequency and date only.
		expect(Object.keys(pastConversion.plan.movements[0] ?? {})).not.toContain(
			"provenance",
		);
		expect(
			isHistoricalMovement(pastConversion.plan.movements[0]!, startDate),
		).toBe(true);

		const future = documentFixture();
		future.postings[0] = {
			...future.postings[0]!,
			frequency: "once",
			startDate: "2026-06-01",
			source: "model",
		};
		const futureConversion = backendToDisplayPlan({
			document: future,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate,
		});
		expect(
			isHistoricalMovement(futureConversion.plan.movements[0]!, startDate),
		).toBe(false);

		const recurring = documentFixture();
		recurring.postings[0] = {
			...recurring.postings[0]!,
			frequency: "monthly",
			startDate: "2026-01-01",
			source: "model",
		};
		const recurringConversion = backendToDisplayPlan({
			document: recurring,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate,
		});
		expect(
			isHistoricalMovement(recurringConversion.plan.movements[0]!, startDate),
		).toBe(false);

		const simplefinDocument = structuredClone(past);
		simplefinDocument.postings[0]!.source = "simplefin";
		const simplefinConversion = backendToDisplayPlan({
			document: simplefinDocument,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate,
		});
		expect(simplefinConversion.plan.movements[0]).toMatchObject({
			readOnly: true,
		});
		expect(
			isHistoricalMovement(simplefinConversion.plan.movements[0]!, startDate),
		).toBe(true);
	});

	it("preserves unchanged backend rows and allows expression-backed amount edits", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		const reverse = displayPlanToBackendDocument(conversion.plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		const amountEdit = displayPlanToBackendDocument(
			{
				...conversion.plan,
				movements: conversion.plan.movements.map((movement) =>
					movement.id === "salary" ? { ...movement, amount: 300 } : movement,
				),
			},
			{ sourceDocument: document, presentation: conversion.presentation },
		);

		expect(reverse.report.losses).toEqual([]);
		expect(reverse.document).toEqual(documentFixture());
		expect(amountEdit.report.losses).toEqual([]);
		expect(amountEdit.document.postings[0]?.amount).toEqual({
			resolver: "expression",
			config: { expression: "300" },
			inputs: {},
		});
		const reloaded = backendToDisplayPlan({
			document: amountEdit.document,
			status: { readOnly: false, authEnabled: false },
			presentation: conversion.presentation,
		});
		expect(reloaded.presentation.movements.salary?.amountValue).toBe(300);
	});

	it("marks provider-backed amounts as provisional and read-only", () => {
		const document = documentFixture();
		document.postings[0]!.amount = {
			resolver: "income",
			config: { incomeSourceId: "salary", resolvers: [] },
			inputs: {},
		};
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
		});
		expect(conversion.plan.movements[0]).toMatchObject({
			amount: 0,
			amountKnown: false,
			readOnly: true,
		});
	});

	it("blocks removal of an account with a SimpleFIN-owned checkpoint", () => {
		const document = documentFixture();
		document.checkpoints[0]!.source = "simplefin";
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		const reverse = displayPlanToBackendDocument(
			{
				...conversion.plan,
				accounts: conversion.plan.accounts.filter(
					(account) => account.id !== "cash",
				),
			},
			{ sourceDocument: document, presentation: conversion.presentation },
		);
		expect(reverse.report.losses).toContainEqual(
			expect.objectContaining({ field: "accounts.cash" }),
		);
	});

	it("does not invent checkpoints for untouched accounts without observations", () => {
		const document = documentFixture();
		document.accounts.push({
			id: "unobserved",
			name: "Unobserved",
			kind: "cash",
			minBalance: NO_FLOOR_SENTINEL,
			maxBalance: NO_CEILING_SENTINEL,
			color: null,
			enabled: true,
		});
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		const edited = {
			...conversion.plan,
			movements: conversion.plan.movements.map((movement) =>
				movement.id === "salary" ? { ...movement, amount: 300 } : movement,
			),
		};
		const reverse = displayPlanToBackendDocument(edited, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(reverse.report.losses).toEqual([]);
		expect(
			reverse.document.checkpoints.some(
				(checkpoint) => checkpoint.AccountId === "unobserved",
			),
		).toBe(false);
	});

	it("preserves checkpoint history while replacing the displayed observation and supports deletions", () => {
		const document = documentFixture();
		document.accounts[0]!.enabled = false;
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(conversion.plan.accounts[0]?.enabled).toBe(false);
		const edited = {
			...conversion.plan,
			accounts: conversion.plan.accounts
				.filter((account) => account.id === "cash")
				.map((account) => ({
					...account,
					balance: 123,
					observedOn: "2026-02-02",
				})),
			movements: conversion.plan.movements.slice(0, 0),
		};
		const reverse = displayPlanToBackendDocument(edited, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(reverse.report.losses).toEqual([]);
		expect(
			reverse.document.checkpoints.filter(
				(checkpoint) => checkpoint.AccountId === "cash",
			),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ Date: "2026-01-31", Balance: 100 }),
				expect.objectContaining({ Date: "2026-03-01", Balance: 999 }),
				expect.objectContaining({ Date: "2026-02-02", Balance: 123 }),
			]),
		);
		expect(reverse.document.accounts.map((account) => account.id)).toEqual([
			"cash",
		]);
		expect(reverse.document.postings).toEqual([]);
		const conflicting = displayPlanToBackendDocument(
			{
				...edited,
				accounts: edited.accounts.map((account) =>
					account.id === "cash"
						? { ...account, observedOn: "2026-03-01" }
						: account,
				),
			},
			{ sourceDocument: document, presentation: conversion.presentation },
		);
		expect(conflicting.report.losses).toContainEqual(
			expect.objectContaining({ field: "accounts.cash.checkpoints" }),
		);
	});

	it("returns a complete backend document and reports local-only losses instead of uploading them", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		const plan = {
			...conversion.plan,
			assumptions: { inflation: 2, volatility: 10 },
			evaluations: [
				...conversion.plan.evaluations,
				{
					id: "reserve",
					name: "Reserve",
					kind: "reserve" as const,
					target: 1000,
					accountId: "cash",
					enabled: true,
				},
			],
		};
		const reverse = displayPlanToBackendDocument(plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});

		expect(reverse.document.accounts.map((account) => account.id)).toEqual([
			"cash",
			"loan",
		]);
		expect(reverse.document.accounts[0]?.minBalance).toBe(NO_FLOOR_SENTINEL);
		expect(reverse.document.accounts[0]?.maxBalance).toBe(NO_CEILING_SENTINEL);
		expect(reverse.document.postings[0]).toMatchObject({
			id: "salary",
			destinations: ["cash"],
			frequency: "monthly",
		});
		expect(reverse.document.evaluations.netWorthThreshold[0]?.config).toEqual({
			target: 500,
		});
		// A reserve evaluation is a first-class backend evaluation, so it uploads
		// rather than being reported as a local-only loss.
		expect(reverse.document.evaluations.accountBalance).toEqual([
			{
				instanceId: "reserve",
				name: "Reserve",
				enabled: true,
				config: { accountId: "cash", target: 1000 },
			},
		]);
		expect(
			reverse.report.losses.some((loss) => loss.field.includes("reserve")),
		).toBe(false);
		expect(reverse.document).not.toHaveProperty("origin");
		expect(reverse.document).not.toHaveProperty("assumptions");
		expect(
			reverse.report.losses.some((loss) => loss.field === "assumptions"),
		).toBe(true);
		expect(reverse.report.hasLosses).toBe(true);
	});

	// A reserve evaluation must survive the round trip, not degrade to browser-only metadata
	// entry that the backend never sees.
	it("round-trips a reserve evaluation through the backend document", () => {
		const base = documentFixture();
		const conversion = backendToDisplayPlan({
			document: {
				...base,
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [],
					accountBalance: [
						{
							instanceId: "emergency",
							name: "Emergency fund",
							enabled: true,
							config: { accountId: "cash", target: 30000 },
						},
					],
					postingFulfillment: [],
				},
			},
			status: { readOnly: false, authEnabled: false },
		});

		const evaluation = conversion.plan.evaluations.find(
			(item) => item.id === "emergency",
		);
		expect(evaluation).toMatchObject({
			kind: "reserve",
			accountId: "cash",
			target: 30000,
		});
		expect(
			conversion.report.provisionalFields.some(
				(field) => field === "evaluations.emergency",
			),
		).toBe(false);
	});

	it("marks a debt with a past zero checkpoint as archived while keeping cash zero visible", () => {
		const document = documentFixture();
		document.checkpoints.push(
			{ Date: "2026-01-15", AccountId: "loan", Balance: 0 },
			{ Date: "2026-01-20", AccountId: "cash", Balance: 0 },
		);
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(
			conversion.plan.accounts.find((account) => account.id === "loan")
				?.archived,
		).toBe(true);
		expect(
			conversion.plan.accounts.find((account) => account.id === "cash")
				?.archived,
		).toBe(false);
	});

	it("does not archive a debt without a past zero checkpoint and preserves archived rows on save", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(
			conversion.plan.accounts.find((account) => account.id === "loan")
				?.archived,
		).toBe(false);
		const reverse = displayPlanToBackendDocument(conversion.plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(reverse.report.losses).toEqual([]);
		expect(reverse.document.accounts.map((account) => account.id)).toEqual([
			"cash",
			"loan",
		]);
	});

	it("hides archived accounts and their movements from display helpers", () => {
		const document = documentFixture();
		document.checkpoints.push({
			Date: "2026-01-15",
			AccountId: "loan",
			Balance: 0,
		});
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false, authEnabled: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(visibleAccounts(conversion.plan.accounts).map((a) => a.id)).toEqual([
			"cash",
		]);
		expect(
			visibleMovements({
				movements: conversion.plan.movements,
				accounts: conversion.plan.accounts,
			}),
		).toEqual(conversion.plan.movements);
		expect(netWorth(conversion.plan)).toBe(
			conversion.plan.accounts
				.filter((a) => a.enabled && !a.archived)
				.reduce((sum, a) => sum + a.balance, 0),
		);
	});
});
