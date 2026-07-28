import {
	getTotalDestinationHeadroom,
	getWithdrawableAmount,
} from "../simulation/accounts";
import type {
	Account,
	AccountMovementConstraint,
	MovementEvent,
	ProjectionPath,
} from "../types/model";

const EPSILON = 1e-9;

export interface MovementConstraintInput {
	sourceAccountId: string | null;
	destinations: string[] | null;
	requestedAmount: number;
	realizedAmount: number;
	balancesBefore: Record<string, number>;
	accountsById: Map<string, Account>;
	limitRemaining?: number;
}

export function classifyMovementConstraints({
	sourceAccountId,
	destinations,
	requestedAmount,
	realizedAmount,
	balancesBefore,
	accountsById,
	limitRemaining,
}: MovementConstraintInput): AccountMovementConstraint[] {
	if (requestedAmount - realizedAmount <= EPSILON) return [];
	if (sourceAccountId !== null && !accountsById.has(sourceAccountId)) {
		return [{ type: "source-unavailable", accountId: sourceAccountId }];
	}

	const constraints: AccountMovementConstraint[] = [];
	const isBinding = (limit: number) =>
		Number.isFinite(limit) && Math.abs(limit - realizedAmount) < EPSILON;
	if (
		sourceAccountId !== null &&
		isBinding(
			getWithdrawableAmount(balancesBefore, accountsById, sourceAccountId),
		)
	) {
		constraints.push({ type: "source-floor", accountId: sourceAccountId });
	}
	if (
		destinations !== null &&
		isBinding(
			getTotalDestinationHeadroom(balancesBefore, accountsById, destinations),
		)
	) {
		constraints.push({
			type: "destination-ceiling",
			accountIds: [...destinations],
		});
	}
	if (limitRemaining !== undefined && isBinding(limitRemaining)) {
		constraints.push({ type: "action-limit" });
	}
	return constraints;
}

export function reconstructBalancesBeforeEvents(
	path: ProjectionPath,
): Map<number, Record<string, number>> {
	const projectedRowsByDate = new Map(
		path.rows
			.filter((row) => !row.isHistorical)
			.map((row) => [row.date, row] as const),
	);
	const eventsByDate = new Map<string, MovementEvent[]>();
	for (const event of path.movementEvents) {
		const events = eventsByDate.get(event.date) ?? [];
		events.push(event);
		eventsByDate.set(event.date, events);
	}

	const balancesBeforeBySequence = new Map<number, Record<string, number>>();
	for (const [date, events] of eventsByDate) {
		const row = projectedRowsByDate.get(date);
		if (!row) {
			throw new Error(`Projection row is missing for movement date "${date}".`);
		}
		let balances = Object.fromEntries(
			row.accountSnapshots.map(({ accountId, balance }) => [
				accountId,
				balance,
			]),
		);
		for (const event of [...events].sort(
			(left, right) => right.sequence - left.sequence,
		)) {
			const before = { ...balances };
			for (const { accountId, delta } of event.accountDeltas) {
				before[accountId] = (before[accountId] ?? 0) - delta;
			}
			balancesBeforeBySequence.set(event.sequence, before);
			balances = before;
		}
	}
	return balancesBeforeBySequence;
}
