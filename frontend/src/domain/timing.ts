import { shiftDate, sum } from "./format.ts";
import type { Plan } from "./model.ts";
import type { Projection } from "./result.ts";

export function upcomingMovements({
	startDate,
	projection,
	days = 30,
}: {
	startDate: string;
	projection: Projection;
	days?: number;
}) {
	const end = shiftDate({ date: startDate, days });
	return {
		end,
		events: projection.movements.filter((movement) => movement.date <= end),
	};
}

export function cashTiming({
	plan,
	projection,
}: {
	plan: Plan;
	projection: Projection;
}) {
	const { events } = upcomingMovements({
		startDate: plan.startDate,
		projection,
	});
	const accounts = plan.accounts.filter(
		(account) => account.enabled && account.kind === "cash",
	);
	const ids = new Set(accounts.map((account) => account.id));
	return {
		cash: sum(
			accounts.map((account) => Math.max(0, account.balance - account.floor)),
		),
		commitments: sum(
			events
				.filter(
					(movement) =>
						movement.fromId &&
						ids.has(movement.fromId) &&
						(!movement.toId || !ids.has(movement.toId)),
				)
				.map((movement) => movement.requested),
		),
		nextPay:
			events.find(
				(movement) =>
					!movement.fromId && movement.toId && ids.has(movement.toId),
			) ?? null,
	};
}
