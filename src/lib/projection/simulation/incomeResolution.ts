import type { IncomeDataSnapshot, IncomeTaxProfile } from "../types/income";
import type { Account, IncomeEvent, Posting } from "../types/model";
import {
	IncomeResolutionError,
	parseIncomeAmountConfig,
	parseStepConfig,
	percentageStepSchema,
	taxStepSchema,
	validateIncomeAmountConfig,
} from "./incomeConfig";
import {
	type AccountMovementResult,
	applyAccountMovement,
	frequencyDivisor,
	resolveAccountMovement,
} from "./postings";

export function progressiveIncomeLiability(
	taxableAmount: number,
	profile: Pick<IncomeTaxProfile, "brackets">,
): number {
	let previousLimit = 0;
	let liability = 0;
	for (const bracket of profile.brackets) {
		const upper = bracket.upTo ?? taxableAmount;
		const width = Math.max(0, Math.min(taxableAmount, upper) - previousLimit);
		liability += width * bracket.rate;
		if (taxableAmount <= upper) break;
		previousLimit = upper;
	}
	return liability;
}

function findIncomeSource(data: IncomeDataSnapshot, id: string, date: string) {
	const matches = data.incomeSources.filter(
		(source) =>
			source.id === id &&
			source.effectiveFrom <= date &&
			(source.effectiveTo === null || date <= source.effectiveTo),
	);
	if (matches.length !== 1) {
		throw new IncomeResolutionError(
			matches.length === 0
				? `No income source '${id}' is effective on ${date}.`
				: `More than one income source '${id}' is effective on ${date}.`,
		);
	}
	return matches[0]!;
}

function findTaxProfile(data: IncomeDataSnapshot, id: string) {
	const profile = data.taxProfiles.find((candidate) => candidate.id === id);
	if (!profile)
		throw new IncomeResolutionError(`Tax profile '${id}' does not exist.`);
	return profile;
}

function applyMovement(
	action: {
		destinations: string[];
		requestedAmount: number;
	},
	balances: Record<string, number>,
	accountById: Map<string, Account>,
): AccountMovementResult & {
	accountDeltas: Array<{ accountId: string; delta: number }>;
} {
	const before = { ...balances };
	const result = resolveAccountMovement(
		{
			sourceAccountId: null,
			destinations: action.destinations,
			requestedAmount: action.requestedAmount,
		},
		balances,
		accountById,
	);
	applyAccountMovement(
		{
			sourceAccountId: null,
			destinations: action.destinations,
			requestedAmount: result.realizedAmount,
		},
		result.realizedAmount,
		balances,
		accountById,
	);
	const accountDeltas: Array<{ accountId: string; delta: number }> = [];
	for (const [accountId, after] of Object.entries(balances)) {
		const delta = after - (before[accountId] ?? 0);
		if (delta !== 0) accountDeltas.push({ accountId, delta });
	}
	return { ...result, accountDeltas };
}

export interface IncomeExecutionResult {
	requestedAmount: number;
	realizedAmount: number;
	accountDeltas: Array<{ accountId: string; delta: number }>;
	income: IncomeEvent;
}

export function executeIncomePosting({
	posting,
	date,
	data,
	balances,
	accountById,
}: {
	posting: Posting;
	date: string;
	data: IncomeDataSnapshot;
	balances: Record<string, number>;
	accountById: Map<string, Account>;
}): IncomeExecutionResult {
	const config = parseIncomeAmountConfig(posting.amount.config);
	validateIncomeAmountConfig(config, {
		accountIds: new Set(accountById.keys()),
		incomeSourceIds: new Set(data.incomeSources.map((source) => source.id)),
		taxProfileIds: new Set(data.taxProfiles.map((profile) => profile.id)),
	});
	const source = findIncomeSource(data, config.incomeSourceId, date);
	const divisor = frequencyDivisor(posting.frequency);
	const grossAmount = source.annualGrossIncome / divisor;
	let annualRemaining = source.annualGrossIncome;
	const resolvers: IncomeEvent["resolvers"] = [];
	const allDeltas: Array<{ accountId: string; delta: number }> = [];
	let employerMatchRequested = 0;
	let employerMatchRealized = 0;

	for (const step of config.resolvers) {
		const beforeStep = annualRemaining;
		let requestedAnnual = 0;
		if (step.resolver === "percentage") {
			const { rate, annualCap = null } = parseStepConfig(
				percentageStepSchema,
				step.config,
				"Invalid income percentage step",
			);
			requestedAnnual = beforeStep * rate;
			if (annualCap !== null)
				requestedAnnual = Math.min(requestedAnnual, annualCap);
		} else {
			const { profileId } = parseStepConfig(
				taxStepSchema,
				step.config,
				"Invalid income tax step",
			);
			const profile = findTaxProfile(data, profileId);
			requestedAnnual = progressiveIncomeLiability(
				Math.max(0, beforeStep - profile.deduction),
				profile,
			);
		}
		const requestedAmount = Math.max(0, requestedAnnual / divisor);
		let realizedAmount = requestedAmount;
		if (step.destinationAccountId !== null) {
			const movement = applyMovement(
				{ destinations: [step.destinationAccountId], requestedAmount },
				balances,
				accountById,
			);
			realizedAmount = movement.realizedAmount;
			allDeltas.push(...movement.accountDeltas);
		}
		annualRemaining = Math.max(0, beforeStep - realizedAmount * divisor);
		let employerMatchAmount = 0;
		let employerMatchRealizedAmount = 0;
		if (step.employerMatchRate !== undefined) {
			employerMatchAmount = realizedAmount * step.employerMatchRate;
			employerMatchRequested += employerMatchAmount;
			const matchMovement = applyMovement(
				{
					destinations: [step.destinationAccountId!],
					requestedAmount: employerMatchAmount,
				},
				balances,
				accountById,
			);
			employerMatchRealized += matchMovement.realizedAmount;
			employerMatchRealizedAmount = matchMovement.realizedAmount;
			allDeltas.push(...matchMovement.accountDeltas);
		}
		resolvers.push({
			resolver: step.resolver,
			requestedAmount,
			realizedAmount,
			destinationAccountId: step.destinationAccountId,
			taxableAmountAfter: annualRemaining,
			employerMatchAmount,
			employerMatchRealizedAmount,
		});
	}

	const netCashRequested = Math.max(0, annualRemaining / divisor);
	const netMovement = applyMovement(
		{
			destinations: posting.destinations ?? [],
			requestedAmount: netCashRequested,
		},
		balances,
		accountById,
	);
	allDeltas.push(...netMovement.accountDeltas);
	const accountDeltas = Array.from(
		allDeltas.reduce((deltas, delta) => {
			deltas.set(
				delta.accountId,
				(deltas.get(delta.accountId) ?? 0) + delta.delta,
			);
			return deltas;
		}, new Map<string, number>()),
		([accountId, delta]) => ({ accountId, delta }),
	).filter((delta) => delta.delta !== 0);
	return {
		requestedAmount: netCashRequested,
		realizedAmount: netMovement.realizedAmount,
		accountDeltas,
		income: {
			annualGrossIncome: source.annualGrossIncome,
			grossAmount,
			resolvers,
			netCashRequested,
			netCashRealized: netMovement.realizedAmount,
			employerMatchRequested,
			employerMatchRealized,
		},
	};
}

export { validateIncomeAmountConfig } from "./incomeConfig";
