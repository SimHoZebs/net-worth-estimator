import { describe, expect, it } from "vitest";
import {
	changesBetween,
	isHistoricalTransaction,
	netWorth,
	validatePlan,
	visibleAccounts,
	visibleTransactions,
} from "../domain/model.ts";
import {
	backendToDisplayPlan,
	displayPlanToBackendDocument,
} from "./adapter.ts";
import type {
	BackendPosting,
	FinancialModelDocument,
	ProjectionResult,
} from "./contracts.ts";
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from "./contracts.ts";
import { diffFinancialModelDocuments } from "./rowSync.ts";

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
		postings: [],
		recurrenceRules: [
			{
				id: "salary",
				name: "Salary",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: {
					resolver: "expression",
					config: { expression: "(250) * growth" },
					inputs: {
						growth: {
							source: "provider",
							provider: "growth-factor",
							arguments: { annualGrowthRate: 0.02 },
						},
					},
				},
				frequency: "monthly",
				startDate: "2026-02-05",
				endDate: null,
				annualCap: null,
				priority: 3,
				enabled: true,
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

function syncedPosting(id: string): BackendPosting {
	return {
		id,
		name: "Pending card charge",
		sourceAccountId: "cash",
		destinations: null,
		amount: {
			resolver: "expression",
			config: { expression: "25.15" },
			inputs: {},
		},
		postedTime: 0,
		transactionTime: 1769904300,
		enabled: false,
		source: "simplefin",
		pending: true,
	};
}

function projectionWithSalaryEvent(requestedAmount: number): ProjectionResult {
	return {
		...projectionFixture(),
		movementEvents: [
			{
				date: "2026-02-05",
				sequence: 0,
				origin: { type: "posting", postingId: "salary" },
				requestedAmount,
				realizedAmount: requestedAmount,
				accountDeltas: null,
			},
		],
	};
}

describe("backend and display plan adapter", () => {
	it("keeps posting property order stable through draft validation", () => {
		const document = documentFixture();
		document.postings = [
			{
				...syncedPosting("01900000-0000-7000-8000-000000000001"),
				executionOrder: 2,
			},
			{
				...syncedPosting("01900000-0000-7000-8000-000000000002"),
				source: "user",
				pending: false,
				purchase: { priority: 1 },
			},
		];
		const { plan, presentation } = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionFixture(),
		});
		const validated = validatePlan(plan);
		if (validated instanceof Error) throw validated;
		expect(changesBetween({ saved: plan, current: validated })).toEqual([]);
		const reversed = displayPlanToBackendDocument(validated, {
			presentation,
			sourceDocument: document,
		});
		expect(reversed.document.postings[0]?.executionOrder).toBe(2);
	});
	it("uses the latest checkpoint at or before projection start and maps bounds, postings, and evaluations", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionWithSalaryEvent(250),
		});

		expect(conversion.plan.startDate).toBe("2026-02-01");
		expect(conversion.plan.accounts[0]?.balance).toBe(100);
		expect(conversion.plan.accounts[0]?.observedOn).toBe("2026-01-31");
		expect(conversion.plan.accounts[0]?.minBalance).toBe(0);
		expect(conversion.plan.accounts[0]?.maxBalance).toBeNull();
		expect(conversion.plan.accounts[1]?.kind).toBe("debt");
		expect(conversion.plan.transactions[0]).toMatchObject({
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
	});

	it("carries account colors to the display plan and back", () => {
		const document = documentFixture();
		document.accounts[0]!.color = "#4287f5";
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
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

	it.each([
		{ source: "user", readOnly: false, expected: false },
		{ source: "simplefin", readOnly: false, expected: true },
		{ source: "other-sync", readOnly: false, expected: true },
		{ source: "user", readOnly: true, expected: true },
	])(
		"round-trips an unchanged account with checkpoint source $source and server readOnly $readOnly",
		({ source, readOnly, expected }) => {
			const document = documentFixture();
			document.checkpoints[0]!.source = source;
			const conversion = backendToDisplayPlan({
				document,
				status: { readOnly },
				startDate: "2026-02-01",
			});

			expect(conversion.plan.accounts[0]?.readOnly).toBe(expected);
			expect(conversion.presentation.accounts.cash?.readOnly).toBe(expected);
			const reverse = displayPlanToBackendDocument(conversion.plan, {
				sourceDocument: document,
				presentation: conversion.presentation,
			});
			expect(reverse.report.losses).toEqual([]);
			expect(reverse.document).toEqual(document);
			expect(reverse.document.accounts[0]).not.toHaveProperty("readOnly");
		},
	);

	it("recomputes account locks through guest and editor transitions with the same presentation", () => {
		const document = documentFixture();
		const initial = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			startDate: "2026-02-01",
		});
		document.checkpoints[0]!.source = "simplefin";
		let presentation = initial.presentation;
		for (const readOnly of [false, true, false]) {
			const conversion = backendToDisplayPlan({
				document,
				status: { readOnly },
				presentation,
				startDate: "2026-02-01",
			});

			expect(conversion.plan.readOnly).toBe(readOnly);
			expect(conversion.presentation.accounts.cash?.readOnly).toBe(true);
			expect(conversion.presentation.accounts.loan?.readOnly).toBe(readOnly);
			const reverse = displayPlanToBackendDocument(conversion.plan, {
				sourceDocument: document,
				presentation: conversion.presentation,
			});
			expect(reverse.report.losses).toEqual([]);
			expect(reverse.document).toEqual(document);
			presentation = conversion.presentation;
		}
	});

	it.each(["user", "simplefin"])(
		"still rejects an account readOnly edit with checkpoint source %s",
		(source) => {
			const document = documentFixture();
			document.checkpoints[0]!.source = source;
			const conversion = backendToDisplayPlan({
				document,
				status: { readOnly: false },
				startDate: "2026-02-01",
			});
			const reverse = displayPlanToBackendDocument(
				{
					...conversion.plan,
					accounts: conversion.plan.accounts.map((account) =>
						account.id === "cash"
							? { ...account, readOnly: !account.readOnly }
							: account,
					),
				},
				{ sourceDocument: document, presentation: conversion.presentation },
			);

			expect(reverse.report.losses).toContainEqual(
				expect.objectContaining({ field: "accounts.cash.readOnly" }),
			);
		},
	);

	// A one-time transaction dated at or before the projection start is historical
	// whoever authored it; a recurring rule is a projection, not a past event.
	// Nothing is stored: the display plan is judged by frequency and date.
	it("classifies a one-time transaction before the projection start as historical", () => {
		const startDate = "2026-02-01";
		const past = documentFixture();
		past.postings = [
			{
				id: "bonus",
				name: "Bonus",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: {
					resolver: "expression",
					config: { expression: "250" },
					inputs: {},
				},
				postedTime: 1767225600,
				transactionTime: 1767225600,
				claim: null,
				enabled: true,
			},
		];
		const pastConversion = backendToDisplayPlan({
			document: past,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate,
		});
		// Nothing is stored: the plan holds frequency and date only.
		const pastTransaction = pastConversion.plan.transactions.find(
			(transaction) => transaction.id === "bonus",
		)!;
		expect(Object.keys(pastTransaction ?? {})).not.toContain("provenance");
		expect(isHistoricalTransaction(pastTransaction, startDate)).toBe(true);

		const future = documentFixture();
		future.postings = [
			{
				...past.postings[0]!,
				id: "future-bonus",
				postedTime: 1780272000,
				transactionTime: 1780272000,
			},
		];
		const futureConversion = backendToDisplayPlan({
			document: future,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate,
		});
		const futureTransaction = futureConversion.plan.transactions.find(
			(transaction) => transaction.id === "future-bonus",
		)!;
		expect(isHistoricalTransaction(futureTransaction, startDate)).toBe(false);

		const recurring = documentFixture();
		recurring.recurrenceRules[0] = {
			...recurring.recurrenceRules[0]!,
			startDate: "2026-01-01",
		};
		const recurringConversion = backendToDisplayPlan({
			document: recurring,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate,
		});
		expect(
			isHistoricalTransaction(
				recurringConversion.plan.transactions[0]!,
				startDate,
			),
		).toBe(false);

		// Backend sync-owned rows carry a non-"user" author; the exact sync
		// name is a backend contract, so the fixture uses a stand-in.
		const syncedDocument = structuredClone(past);
		syncedDocument.postings[0]!.source = "bank-sync";
		const syncedConversion = backendToDisplayPlan({
			document: syncedDocument,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate,
		});
		const syncedTransaction = syncedConversion.plan.transactions.find(
			(transaction) => transaction.id === "bonus",
		)!;
		expect(syncedTransaction).toMatchObject({
			readOnly: true,
		});
		expect(isHistoricalTransaction(syncedTransaction, startDate)).toBe(true);
	});

	it("preserves unchanged backend rows and allows expression-backed amount edits", () => {
		const document = documentFixture();
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionWithSalaryEvent(250),
			startDate: "2026-02-01",
		});
		const reverse = displayPlanToBackendDocument(conversion.plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		const amountEdit = displayPlanToBackendDocument(
			{
				...conversion.plan,
				transactions: conversion.plan.transactions.map((transaction) =>
					transaction.id === "salary"
						? { ...transaction, amount: 300 }
						: transaction,
				),
			},
			{ sourceDocument: document, presentation: conversion.presentation },
		);

		expect(reverse.report.losses).toEqual([]);
		expect(reverse.document).toEqual(documentFixture());
		expect(amountEdit.report.losses).toEqual([]);
		expect(amountEdit.document.recurrenceRules[0]?.amount).toEqual({
			resolver: "expression",
			config: { expression: "(300) * growth" },
			inputs: {
				growth: {
					source: "provider",
					provider: "growth-factor",
					arguments: { annualGrowthRate: 0.02 },
				},
			},
		});
		const reloaded = backendToDisplayPlan({
			document: amountEdit.document,
			status: { readOnly: false },
			presentation: conversion.presentation,
			projection: projectionWithSalaryEvent(300),
		});
		expect(reloaded.presentation.transactions.salary?.amountValue).toBe(300);
	});

	it.each([
		"01900000-0000-7000-8000-000000000001",
		"550e8400-e29b-41d4-a716-446655440000",
	])(
		"round-trips an existing synced UUID posting %s without row writes",
		(id) => {
			const document = documentFixture();
			document.postings = [syncedPosting(id)];
			const conversion = backendToDisplayPlan({
				document,
				status: { readOnly: false },
				startDate: "2026-02-01",
			});
			expect(
				conversion.plan.transactions.find((row) => row.id === id),
			).toMatchObject({
				readOnly: true,
				enabled: false,
				pending: true,
			});
			const reverse = displayPlanToBackendDocument(conversion.plan, {
				sourceDocument: document,
				presentation: conversion.presentation,
			});

			expect(reverse.report.losses).toEqual([]);
			expect(reverse.document).toEqual(document);
			expect(diffFinancialModelDocuments(document, reverse.document)).toEqual(
				[],
			);
		},
	);

	it.each([
		"01900000-0000-7000-8000-000000000001",
		"550e8400-e29b-41d4-a716-446655440000",
	])(
		"rejects browser-forged pending metadata on a new UUID posting %s",
		(id) => {
			const document = documentFixture();
			document.postings = [syncedPosting(id)];
			const conversion = backendToDisplayPlan({
				document,
				status: { readOnly: false },
				startDate: "2026-02-01",
			});
			const reverse = displayPlanToBackendDocument(conversion.plan, {
				sourceDocument: documentFixture(),
				presentation: conversion.presentation,
			});

			expect(reverse.report.losses).toContainEqual(
				expect.objectContaining({
					field: `transactions.${id}.pending`,
					message: "Pending status is server-owned bank metadata.",
				}),
			);
		},
	);

	it("rejects converting an existing synced posting into a recurrence rule", () => {
		const document = documentFixture();
		const posting = syncedPosting("01900000-0000-7000-8000-000000000001");
		document.postings = [posting];
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			startDate: "2026-02-01",
		});
		const reverse = displayPlanToBackendDocument(
			{
				...conversion.plan,
				transactions: conversion.plan.transactions.map((row) =>
					row.id === posting.id ? { ...row, frequency: "monthly" } : row,
				),
			},
			{ sourceDocument: document, presentation: conversion.presentation },
		);

		expect(reverse.report.losses).toContainEqual(
			expect.objectContaining({ field: `transactions.${posting.id}.readOnly` }),
		);
	});

	it("round-trips a claim from a posting through the display transaction", () => {
		const document = documentFixture();
		document.postings = [
			{
				id: "rent-actual",
				name: "February rent",
				sourceAccountId: "cash",
				destinations: null,
				amount: {
					resolver: "expression",
					config: { expression: "950" },
					inputs: {},
				},
				postedTime: 1770249600,
				transactionTime: 1770249600,
				claim: { ruleId: "salary", occurrenceDate: "2026-02-05" },
				enabled: true,
			},
		];
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(
			conversion.plan.transactions.find(
				(transaction) => transaction.id === "rent-actual",
			),
		).toMatchObject({
			frequency: "once",
			claimRuleId: "salary",
			claimOccurrenceDate: "2026-02-05",
		});
		const untouched = displayPlanToBackendDocument(conversion.plan, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(untouched.report.losses).toEqual([]);
		expect(
			untouched.document.postings.find(
				(posting) => posting.id === "rent-actual",
			)?.claim,
		).toEqual({ ruleId: "salary", occurrenceDate: "2026-02-05" });
		const cleared = {
			...conversion.plan,
			transactions: conversion.plan.transactions.map((transaction) =>
				transaction.id === "rent-actual"
					? { ...transaction, claimRuleId: null, claimOccurrenceDate: null }
					: transaction,
			),
		};
		const reverse = displayPlanToBackendDocument(cleared, {
			sourceDocument: document,
			presentation: conversion.presentation,
		});
		expect(reverse.report.losses).toEqual([]);
		expect(
			reverse.document.postings.find((posting) => posting.id === "rent-actual")
				?.claim,
		).toBeNull();
	});

	it("marks provider-backed amounts as provisional and read-only", () => {
		const document = documentFixture();
		document.recurrenceRules[0]!.amount = {
			resolver: "progressive-bracket",
			config: { deduction: 1000, brackets: [{ upTo: 5000, rate: 0.1 }] },
			inputs: {
				gross: {
					source: "provider",
					provider: "model-value",
					arguments: { id: "gross-rule" },
				},
				pretax: { source: "literal", value: 0 },
			},
		};
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionFixture(),
		});
		expect(conversion.plan.transactions[0]).toMatchObject({
			amount: 0,
			amountKnown: false,
			readOnly: true,
		});
	});

	it("blocks removal of an account with a synced checkpoint", () => {
		const document = documentFixture();
		document.checkpoints[0]!.source = "bank-sync";
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
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
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		const edited = {
			...conversion.plan,
			transactions: conversion.plan.transactions.map((transaction) =>
				transaction.id === "salary"
					? { ...transaction, amount: 300 }
					: transaction,
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
			status: { readOnly: false },
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
			transactions: conversion.plan.transactions.slice(0, 0),
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
		expect(reverse.document.recurrenceRules).toEqual([]);
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
			status: { readOnly: false },
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
		expect(reverse.document.recurrenceRules[0]).toMatchObject({
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
			status: { readOnly: false },
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
			status: { readOnly: false },
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
			status: { readOnly: false },
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

	it("hides archived accounts and their transactions from display helpers", () => {
		const document = documentFixture();
		document.checkpoints.push({
			Date: "2026-01-15",
			AccountId: "loan",
			Balance: 0,
		});
		const conversion = backendToDisplayPlan({
			document,
			status: { readOnly: false },
			projection: projectionFixture(),
			startDate: "2026-02-01",
		});
		expect(visibleAccounts(conversion.plan.accounts).map((a) => a.id)).toEqual([
			"cash",
		]);
		expect(
			visibleTransactions({
				transactions: conversion.plan.transactions,
				accounts: conversion.plan.accounts,
			}),
		).toEqual(conversion.plan.transactions);
		expect(netWorth(conversion.plan)).toBe(
			conversion.plan.accounts
				.filter((a) => a.enabled && !a.archived)
				.reduce((sum, a) => sum + a.balance, 0),
		);
	});
});
