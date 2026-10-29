import { AlertTriangle, CalendarDays, Clock3 } from "lucide-react";
import { dateLabel } from "../../domain/format.ts";
import type { PlannedPurchase } from "../../domain/model.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";
import { PurchaseRow } from "./PurchaseRow.tsx";

interface DateGroup {
	date: string;
	items: PurchaseViewItem[];
}

/** A date-grouped event view: never spreads purchases over a mostly-empty 20-year axis. */
export function PurchaseScheduleView({
	items,
	forecastEnd,
	onInspect,
}: {
	items: PurchaseViewItem[];
	forecastEnd: string;
	onInspect: (item: PlannedPurchase) => void;
}) {
	const dates = new Map<string, PurchaseViewItem[]>();
	const waiting: PurchaseViewItem[] = [];
	const excluded: PurchaseViewItem[] = [];
	for (const item of items) {
		const outcome = item.outcome;
		if (outcome.kind === "excluded") {
			excluded.push(item);
			continue;
		}
		const date =
			outcome.kind === "scheduled" || outcome.kind === "fixed-conflict"
				? outcome.date
				: null;
		if (!date) {
			waiting.push(item);
			continue;
		}
		dates.set(date, [...(dates.get(date) ?? []), item]);
	}
	const groups: DateGroup[] = [...dates]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, entries]) => ({ date, items: entries }));
	return (
		<section aria-label="Purchase schedule" className="space-y-4">
			<p className="text-xs text-muted">
				Dates shift automatically as your forecast changes. Fixed-date
				requirements cannot shift.
			</p>
			{groups.map((group) => {
				const hasConflict = group.items.some(
					(item) => item.outcome.kind === "fixed-conflict",
				);
				return (
					<div
						key={group.date}
						className="grid grid-cols-[--spacing(6)_minmax(0,1fr)] gap-3"
					>
						<div
							className="flex flex-col items-center gap-2 pt-1"
							aria-hidden="true"
						>
							<span
								className={`grid size-6 place-items-center rounded-full ${hasConflict ? "bg-danger-bg text-danger-text" : "bg-success-bg text-success-text"}`}
							>
								{hasConflict ? (
									<AlertTriangle size={14} />
								) : (
									<CalendarDays size={14} />
								)}
							</span>
							<span className="h-full min-h-5 w-px bg-line" />
						</div>
						<div className="min-w-0 pb-4">
							<h3
								className={`text-sm font-semibold ${hasConflict ? "text-danger-text" : "text-ink"}`}
							>
								<time dateTime={group.date}>{dateLabel(group.date, true)}</time>
							</h3>
							<ol
								className="m-0 mt-1 list-none rounded-surface border border-line bg-surface px-2"
								// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
								role="list"
							>
								{group.items.map((item) => (
									<PurchaseRow
										key={item.purchase.id}
										item={item}
										onInspect={onInspect}
									/>
								))}
							</ol>
						</div>
					</div>
				);
			})}
			{waiting.length > 0 && (
				<div className="grid grid-cols-[--spacing(6)_minmax(0,1fr)] gap-3">
					<div
						className="grid size-6 place-items-center rounded-full bg-surface-3 text-muted"
						aria-hidden="true"
					>
						<Clock3 size={14} />
					</div>
					<div className="min-w-0">
						<h3 className="text-sm font-semibold text-ink">Not yet dated</h3>
						<p className="mt-1 text-xs text-muted">
							No calculated date before {dateLabel(forecastEnd, true)}, or
							evaluation is pending. This does not mean the purchase is
							impossible.
						</p>
						<ol
							className="m-0 mt-2 list-none rounded-surface border border-line bg-surface px-2"
							// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
							role="list"
						>
							{waiting.map((item) => (
								<PurchaseRow
									key={item.purchase.id}
									item={item}
									onInspect={onInspect}
								/>
							))}
						</ol>
					</div>
				</div>
			)}
			{excluded.length > 0 && (
				<div className="ml-8">
					<h3 className="text-sm font-semibold text-muted">
						Excluded from account
					</h3>
					<ol
						className="m-0 mt-2 list-none rounded-surface border border-line bg-surface px-2"
						// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
						role="list"
					>
						{excluded.map((item) => (
							<PurchaseRow
								key={item.purchase.id}
								item={item}
								onInspect={onInspect}
							/>
						))}
					</ol>
				</div>
			)}
			{groups.length === 0 && waiting.length === 0 && excluded.length === 0 && (
				<p className="text-sm text-muted">No purchases to schedule.</p>
			)}
		</section>
	);
}
