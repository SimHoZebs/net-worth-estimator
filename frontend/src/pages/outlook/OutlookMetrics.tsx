import { CircleHelp, TrendingUp } from "lucide-react";
import { IconButton, TextButton } from "../../components/Button.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import { currentNetWorth, type Projection } from "../../domain/result.ts";
import type { useCurrentPosition } from "../../state/useCurrentPosition.ts";

export function OutlookMetrics({
	plan,
	projection,
	position,
	years,
	onEvidence,
	pending = false,
}: {
	plan: Plan;
	projection: Projection | null;
	position: ReturnType<typeof useCurrentPosition>;
	years: number;
	onEvidence: () => void;
	pending?: boolean;
}) {
	const current = position.data?.netWorth ?? null;
	const forecastCurrent = projection ? currentNetWorth(projection) : null;
	const final = projection?.points.at(-1);
	const finalYear =
		final?.date.slice(0, 4) ??
		Number.parseInt(plan.startDate.slice(0, 4), 10) + years;
	return (
		<div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
			<section
				className="flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border border-line bg-surface p-5 print:break-inside-avoid"
				aria-busy={position.status === "pending"}
			>
				<div className="flex min-h-6 items-center justify-between gap-3 text-xs text-muted">
					<span>Current net worth</span>
					<IconButton
						icon={CircleHelp}
						size="sm"
						iconSize={14}
						className="size-6"
						label="Inspect current net worth evidence"
						onClick={onEvidence}
						disabled={!position.data}
					/>
				</div>
				{position.status === "error" ? (
					<div className="text-sm text-muted" role="status">
						Could not load current position.{" "}
						<TextButton onClick={position.retry}>
							Retry current position
						</TextButton>
					</div>
				) : current === null ? (
					<Skeleton className="h-7 w-32" />
				) : (
					<div className="flex flex-wrap items-center gap-2 text-xl leading-tight font-medium tracking-tight tabular-nums sm:text-2xl xl:text-3xl">
						{money(current)}
					</div>
				)}
				<div className="flex items-center gap-2 text-xs text-muted max-sm:flex-wrap">
					<span
						className="inline-block size-1 rounded-full bg-primary"
						aria-hidden="true"
					/>
					As of {dateLabel(position.data?.asOfDate ?? plan.startDate, true)}
				</div>
			</section>
			<section
				className="flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border border-success-border bg-success-bg p-5 print:break-inside-avoid"
				aria-busy={pending}
			>
				<div className="flex min-h-6 items-center justify-between gap-3 text-xs text-muted">
					<span>Base case in {finalYear}</span>
					<TrendingUp size={19} className="max-sm:w-4" aria-hidden="true" />
				</div>
				{!final || forecastCurrent === null ? (
					pending ? (
						<Skeleton className="h-7 w-36" />
					) : (
						<p className="text-sm text-muted">Forecast unavailable</p>
					)
				) : (
					<div
						className="flex flex-wrap items-center gap-2 text-xl leading-tight font-medium tracking-tight text-ink tabular-nums sm:text-2xl xl:text-3xl"
						title={money(final.total)}
					>
						{compactMoney(final.total)}
						<span className="rounded-control bg-success-bg px-2 py-1 text-xs font-semibold tracking-normal text-success-text max-sm:px-1">
							{final.total >= forecastCurrent ? "+" : ""}
							{compactMoney(final.total - forecastCurrent)}
						</span>
					</div>
				)}
				<div className="flex items-center gap-2 text-xs text-muted">
					{years}-year projection
				</div>
			</section>
		</div>
	);
}
