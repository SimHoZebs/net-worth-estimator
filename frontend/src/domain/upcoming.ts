import { shiftDate } from "./format.ts";
import type { Projection } from "./result.ts";

export function upcomingTransactions({
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
		events: projection.transactions.filter((transaction) => transaction.date <= end),
	};
}
