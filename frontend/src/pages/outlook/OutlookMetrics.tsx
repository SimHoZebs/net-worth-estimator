import { CircleHelp, TrendingUp } from "lucide-react";
import { IconButton } from "../../components/Button.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import { currentNetWorth, type Projection } from "../../domain/result.ts";
import { outlookMetricStyles } from "./outlookMetricStyles.ts";

export function OutlookMetrics({
	plan,
	projection,
	years,
	onEvidence,
	pending = false,
}: {
	plan: Plan;
	projection: Projection | null;
	years: number;
	onEvidence: () => void;
	pending?: boolean;
}) {
	if (!projection && !pending) return null;
	const current = projection ? currentNetWorth(projection) : null;
	const final = projection?.points.at(-1);
	if (projection && !final) return null;
	const finalYear =
		final?.date.slice(0, 4) ??
		Number.parseInt(plan.startDate.slice(0, 4), 10) + years;
	return (
		<div
			className="grid grid-cols-2 gap-3 lg:grid-cols-1"
			aria-busy={!projection || undefined}
		>
			<section className={outlookMetricStyles()}>
				<div className="mb-2 flex min-h-6 items-center justify-between text-xs text-muted max-sm:mb-3 max-sm:gap-1">
					<span>Current net worth</span>
					<IconButton
						icon={CircleHelp}
						size="sm"
						iconSize={14}
						className="size-6"
						label="Inspect current net worth evidence"
						onClick={onEvidence}
						disabled={!projection}
					/>
				</div>
				{current === null ? (
					<Skeleton className="h-7 w-32" />
				) : (
					<div className="flex flex-wrap items-center gap-2 text-xl leading-tight font-medium tracking-tight tabular-nums sm:text-2xl xl:text-3xl">
						{money(current)}
					</div>
				)}
				<div className="mt-2 flex items-center gap-2 text-xs text-muted max-sm:mt-3 max-sm:flex-wrap max-sm:gap-1">
					<span
						className="inline-block size-1 rounded-full bg-primary"
						aria-hidden="true"
					/>
					As of {dateLabel(plan.startDate, true)}
				</div>
			</section>
			<section className={outlookMetricStyles({ tone: "projected" })}>
				<div className="mb-2 flex min-h-6 items-center justify-between text-xs text-muted max-sm:mb-3 max-sm:gap-1">
					<span>Base case in {finalYear}</span>
					<TrendingUp size={19} className="max-sm:w-4" aria-hidden="true" />
				</div>
				{!final || current === null ? (
					<Skeleton className="h-7 w-36" />
				) : (
					<div
						className="flex flex-wrap items-center gap-2 text-xl leading-tight font-medium tracking-tight text-ink tabular-nums sm:text-2xl xl:text-3xl"
						title={money(final.total)}
					>
						{compactMoney(final.total)}
						<span className="rounded-control bg-success-bg px-2 py-1 text-xs font-semibold tracking-normal text-success-text max-sm:px-1">
							{final.total >= current ? "+" : ""}
							{compactMoney(final.total - current)}
						</span>
					</div>
				)}
				<div className="mt-2 flex items-center gap-2 text-xs text-muted max-sm:mt-3 max-sm:flex-wrap max-sm:gap-1">
					{years}-year projection
				</div>
			</section>
		</div>
	);
}
