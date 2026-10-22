import { CircleHelp, TrendingUp } from "lucide-react";
import { IconButton } from "../../components/Button.tsx";
import { Skeleton } from "../../components/ui.tsx";
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
			className="mb-0 flex flex-col gap-3 [@media(1050px<width<=1250px)]:gap-2.5 [@media(max-width:1050px)]:grid [@media(max-width:1050px)]:grid-cols-2 [@media(600px<width<=1050px)]:gap-3 [@media(max-width:600px)]:gap-2.5"
			aria-busy={!projection || undefined}
		>
			<section className={outlookMetricStyles()}>
				<div className="mb-1.5 flex min-h-6 items-center justify-between text-xs text-muted [@media(max-width:600px)]:mb-3 [@media(max-width:600px)]:gap-1">
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
					<Skeleton width={120} height={28} />
				) : (
					<div className="flex flex-wrap items-center gap-2 text-3xl leading-tight font-medium tracking-tight tabular-nums [@media(600px<width<=1250px)]:text-2xl [@media(max-width:600px)]:gap-y-2 [@media(max-width:370px)]:text-2xl">
						{money(current)}
					</div>
				)}
				<div className="mt-2 flex items-center gap-2 text-xs text-muted [@media(max-width:600px)]:mt-3 [@media(max-width:600px)]:flex-wrap [@media(max-width:600px)]:gap-1">
					<span
						className="inline-block size-1 rounded-full bg-primary"
						aria-hidden="true"
					/>
					As of {dateLabel(plan.startDate, true)}
				</div>
			</section>
			<section className={outlookMetricStyles({ tone: "projected" })}>
				<div className="mb-1.5 flex min-h-6 items-center justify-between text-xs text-muted [@media(max-width:600px)]:mb-3 [@media(max-width:600px)]:gap-1">
					<span>Base case in {finalYear}</span>
					<TrendingUp
						size={19}
						className="[@media(max-width:600px)]:w-4"
						aria-hidden="true"
					/>
				</div>
				{!final || current === null ? (
					<Skeleton width={140} height={28} />
				) : (
					<div
						className="flex flex-wrap items-center gap-2 text-3xl leading-tight font-medium tracking-tight text-ink tabular-nums [@media(max-width:1250px)]:text-2xl [@media(max-width:600px)]:gap-y-2 [@media(max-width:600px)]:text-3xl"
						title={money(final.total)}
					>
						{compactMoney(final.total)}
						<span className="rounded-control bg-success-bg px-2 py-1 text-xs font-semibold tracking-normal text-success-text [@media(max-width:600px)]:px-1">
							{final.total >= current ? "+" : ""}
							{compactMoney(final.total - current)}
						</span>
					</div>
				)}
				<div className="mt-2 flex items-center gap-2 text-xs text-muted [@media(max-width:600px)]:mt-3 [@media(max-width:600px)]:flex-wrap [@media(max-width:600px)]:gap-1">
					{years}-year projection
				</div>
			</section>
		</div>
	);
}
