import type { BackendCheckpoint } from "../../api/contracts.ts";
import type { ReactNode } from "react";
import { dateLabel, money } from "../../domain/format.ts";
import { netWorthChangeSinceFirstSync } from "../../domain/netWorthChange.ts";
import type { Projection } from "../../domain/result.ts";

const changePercent = new Intl.NumberFormat("en-US", {
	style: "percent",
	maximumFractionDigits: 1,
	signDisplay: "exceptZero",
});

export function NetWorthSummary({
	projection,
	checkpoints,
	actions,
}: {
	projection: Projection;
	checkpoints: readonly BackendCheckpoint[];
	actions?: ReactNode;
}) {
	const change = netWorthChangeSinceFirstSync(projection, checkpoints);
	const asOf = checkpoints
		.map((checkpoint) =>
			new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10),
		)
		.reduce<string | null>(
			(latest, day) => (latest === null || day > latest ? day : latest),
			null,
		);
	return (
		<div className="px-5 pt-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<h2 className="text-sm text-muted">Net worth</h2>
					<div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<strong className="type-value text-3xl font-medium tracking-tight text-ink [overflow-wrap:anywhere]">
							{money(projection.currentNetWorth)}
						</strong>
						{asOf && (
							<span className="text-xs text-muted">
								As of {dateLabel(asOf, true)}
							</span>
						)}
					</div>
					{change && (
						<p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs">
							<span
								className={`font-semibold tabular-nums ${change.amount > 0 ? "text-success-text" : change.amount < 0 ? "text-danger-text" : "text-muted"}`}
							>
								{change.amount > 0 ? "+" : ""}
								{money(change.amount)}
								{change.fraction !== null &&
									` (${changePercent.format(change.fraction)})`}
							</span>
							<span>since first sync · {dateLabel(change.date, true)}</span>
						</p>
					)}
				</div>
				{actions && (
					<div className="flex flex-wrap items-center justify-end gap-2">
						{actions}
					</div>
				)}
			</div>
		</div>
	);
}
