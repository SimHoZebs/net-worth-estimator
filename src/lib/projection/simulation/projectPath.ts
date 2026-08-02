import type { IncomeDataSnapshot } from "../types/income";
import type {
	Account,
	AccountDelta,
	AccountSnapshot,
	FinancialModelDocument,
	ModelOverrides,
	MovementEvent,
	ProjectionAccountSummary,
	ProjectionPath,
	ProjectionRow,
	ProjectionRuntimeSettings,
	RawProjectionOutput,
} from "../types/model";
import type {
	MonteCarloSample,
	PreparedProjection,
	SimulationRun,
} from "../types/simulation";
import { computeNetWorth } from "./accounts";
import { prepareSimulationRequest } from "./prepareSimulation";
import { simulate } from "./simulate";
import { cloneSimulationState } from "./transitions";

function roundCurrency(value: number): number {
	return Math.round(value);
}

function createRow({
	date,
	isHistorical,
	balances,
	accounts,
	accountImpacts,
	externalInflowAmount,
	externalOutflowAmount,
	internalTransferAmount,
}: {
	date: string;
	isHistorical: boolean;
	balances: Record<string, number>;
	accounts: Account[];
	accountImpacts: Record<string, AccountDelta[]>;
	externalInflowAmount: number;
	externalOutflowAmount: number;
	internalTransferAmount: number;
}): ProjectionRow {
	const accountSnapshots: AccountSnapshot[] = accounts.map((account) => ({
		accountId: account.id,
		date,
		balance: balances[account.id] ?? 0,
		impacts: accountImpacts[account.id] ?? [],
	}));

	return {
		date,
		isHistorical,
		netWorth: computeNetWorth(balances, accounts),
		accountSnapshots,
		externalInflowAmount,
		externalOutflowAmount,
		internalTransferAmount,
	};
}

function roundRow(row: ProjectionRow): ProjectionRow {
	return {
		...row,
		netWorth: roundCurrency(row.netWorth),
		externalInflowAmount: roundCurrency(row.externalInflowAmount),
		externalOutflowAmount: roundCurrency(row.externalOutflowAmount),
		internalTransferAmount: roundCurrency(row.internalTransferAmount),
		accountSnapshots: row.accountSnapshots.map((snapshot) => ({
			...snapshot,
			balance: roundCurrency(snapshot.balance),
			impacts: snapshot.impacts.map((impact) => ({
				...impact,
				delta: roundCurrency(impact.delta),
			})),
		})),
	};
}

function classifyAttempts(
	attempts: readonly MovementEvent[],
	postingsById: ReadonlyMap<string, FinancialModelDocument["postings"][number]>,
) {
	const accountImpacts: Record<string, AccountDelta[]> = {};
	let externalInflowAmount = 0;
	let externalOutflowAmount = 0;
	let internalTransferAmount = 0;

	for (const attempt of attempts) {
		const posting = postingsById.get(attempt.origin.postingId);
		if (!posting) continue;
		for (const { accountId, delta } of attempt.accountDeltas) {
			if (!accountImpacts[accountId]) accountImpacts[accountId] = [];
			accountImpacts[accountId].push({
				postingId: posting.id,
				delta,
			});
		}
		if (attempt.income) {
			externalInflowAmount +=
				attempt.income.netCashRealized +
				attempt.income.resolvers
					.filter((resolver) => resolver.destinationAccountId !== null)
					.reduce((sum, resolver) => sum + resolver.realizedAmount, 0) +
				attempt.income.employerMatchRealized;
			continue;
		}
		if (posting.sourceAccountId === null && posting.destinations !== null) {
			externalInflowAmount += attempt.realizedAmount;
		} else if (
			posting.sourceAccountId !== null &&
			posting.destinations === null
		) {
			externalOutflowAmount += attempt.realizedAmount;
		} else if (
			posting.sourceAccountId !== null &&
			posting.destinations !== null
		) {
			internalTransferAmount += attempt.realizedAmount;
		}
	}

	return {
		accountImpacts,
		externalInflowAmount,
		externalOutflowAmount,
		internalTransferAmount,
	};
}

export function adaptSimulationRun(
	prepared: PreparedProjection,
	run: SimulationRun,
): RawProjectionOutput {
	const path = buildProjectionPath(prepared, run);
	const accounts = prepared.effectiveDocument.accounts;
	const { rows } = path;
	const historicalRows = rows.filter((row) => row.isHistorical);
	const latestHistoricalRow = historicalRows[historicalRows.length - 1] ?? null;
	const latestRow = rows[rows.length - 1] ?? null;
	const currentNetWorth =
		latestHistoricalRow?.netWorth ??
		computeNetWorth(run.initialState.balances, accounts);
	const endingBalances = latestRow
		? Object.fromEntries(
				latestRow.accountSnapshots.map((snapshot) => [
					snapshot.accountId,
					snapshot.balance,
				]),
			)
		: run.initialState.balances;
	const accountSummaries: ProjectionAccountSummary[] = accounts.map(
		(account) => ({
			accountId: account.id,
			label: account.label,
			color: account.color,
			enabled: account.enabled,
			startingBalance: roundCurrency(
				run.initialState.balances[account.id] ?? 0,
			),
			endingBalance: roundCurrency(endingBalances[account.id] ?? 0),
		}),
	);
	const totals = rows.reduce(
		(result, row) => ({
			externalInflowAmount:
				result.externalInflowAmount + row.externalInflowAmount,
			externalOutflowAmount:
				result.externalOutflowAmount + row.externalOutflowAmount,
			internalTransferAmount:
				result.internalTransferAmount + row.internalTransferAmount,
		}),
		{
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		},
	);

	return {
		path,
		result: {
			timeline: {
				rows: rows.map(roundRow),
				sampledRows: rows.map(roundRow),
			},
			accountSummaries,
			totals: {
				externalInflowAmount: roundCurrency(totals.externalInflowAmount),
				externalOutflowAmount: roundCurrency(totals.externalOutflowAmount),
				internalTransferAmount: roundCurrency(totals.internalTransferAmount),
			},
			milestones: {
				latestHistoricalDate: latestHistoricalRow?.date ?? null,
				projectionStartDate: run.request.startDate,
			},
			summary: {
				currentNetWorth: roundCurrency(currentNetWorth),
				finalNetWorth: roundCurrency(latestRow?.netWorth ?? currentNetWorth),
			},
		},
	};
}

export function buildProjectionPath(
	prepared: PreparedProjection,
	run: SimulationRun,
): ProjectionPath {
	const accounts = prepared.effectiveDocument.accounts;
	const postingsById = new Map(
		prepared.effectiveDocument.postings.map((posting) => [posting.id, posting]),
	);
	const attemptsByDate = new Map<string, MovementEvent[]>();
	for (const attempt of run.movementAttempts) {
		const attempts = attemptsByDate.get(attempt.date) ?? [];
		attempts.push(attempt);
		attemptsByDate.set(attempt.date, attempts);
	}

	const historicalRows = prepared.historicalSnapshots.map((snapshot) =>
		createRow({
			date: snapshot.date,
			isHistorical: true,
			balances: snapshot.balances,
			accounts,
			accountImpacts: {},
			externalInflowAmount: 0,
			externalOutflowAmount: 0,
			internalTransferAmount: 0,
		}),
	);
	const projectedRows = run.snapshots.map((snapshot) => {
		const classified = classifyAttempts(
			attemptsByDate.get(snapshot.date) ?? [],
			postingsById,
		);
		return createRow({
			date: snapshot.date,
			isHistorical: false,
			balances: snapshot.balances,
			accounts,
			...classified,
		});
	});
	const rows = [...historicalRows, ...projectedRows];

	return {
		rows,
		movementEvents: run.movementAttempts,
		effectiveDocument: prepared.effectiveDocument,
		incomeData: run.request.incomeData,
		projectionStartPostingState: (() => {
			const state = cloneSimulationState(run.initialState);
			return {
				latestRealizedPostingAmounts: state.latestRealizedPostingAmounts,
				realizedPostingAmountsByYear: state.realizedPostingAmountsByYear,
			};
		})(),
		projectionStartDate: run.request.startDate,
		projectionEndDate: run.request.endDate,
	};
}

export function projectRawFinancialModelDocument(
	document: FinancialModelDocument,
	projectionSettings: ProjectionRuntimeSettings,
	overrides?: ModelOverrides,
	monteCarloSample?: MonteCarloSample,
	incomeData?: IncomeDataSnapshot,
): RawProjectionOutput {
	const prepared = prepareSimulationRequest(
		document,
		projectionSettings,
		overrides,
		monteCarloSample,
		incomeData,
	);
	return adaptSimulationRun(prepared, simulate(prepared.request));
}
