import { memo, useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import {
	currency,
	formatDate,
	formatIsoDateLocal,
	parseIsoDateLocal,
} from "@/lib/format";
import type {
	Account,
	Posting,
	PostingFulfillmentPathResult,
	ProjectionRow,
} from "@/lib/projection";
import { ShortfallDetailPanel } from "./ShortfallDetailPanel";

interface ShortfallCalendarProps {
	fulfillment: PostingFulfillmentPathResult | null;
	rows: ProjectionRow[];
	postings: Posting[];
	accounts: Account[];
}

interface ShortfallDay {
	date: string;
	label: string;
	requestedPostingAmount: number;
	realizedPostingAmount: number;
	unfulfilledAmount: number;
	netWorth: number;
}

export const ShortfallCalendar = memo(function ShortfallCalendar({
	fulfillment,
	rows,
	postings,
	accounts,
}: ShortfallCalendarProps) {
	const [selectedDateIso, setSelectedDateIso] = useState<string | null>(null);

	const postingById = useMemo(() => {
		const map: Record<string, Posting> = {};
		for (const posting of postings) map[posting.id] = posting;
		return map;
	}, [postings]);

	const shortfallDays = useMemo(() => {
		if (!fulfillment) return [];
		return fulfillment.dates
			.filter((day) => day.unfulfilledAmount > 0)
			.map(
				(day): ShortfallDay => ({
					date: day.date,
					label: formatDate(day.date),
					requestedPostingAmount: day.requestedAmount,
					realizedPostingAmount: day.realizedAmount,
					unfulfilledAmount: day.unfulfilledAmount,
					netWorth: rows.find((row) => row.date === day.date)?.netWorth ?? 0,
				}),
			);
	}, [fulfillment, rows]);

	const shortfallDayByDate = useMemo(() => {
		const map = new Map<string, ShortfallDay>();
		for (const day of shortfallDays) map.set(day.date, day);
		return map;
	}, [shortfallDays]);

	const shortfallDates = useMemo(
		() => shortfallDays.map((day) => parseIsoDateLocal(day.date)),
		[shortfallDays],
	);
	const selectedDay = selectedDateIso
		? (shortfallDayByDate.get(selectedDateIso) ?? null)
		: null;
	const selectedEvents = selectedDay
		? (fulfillment?.events.filter((event) => event.date === selectedDay.date) ??
			[])
		: [];
	const totalShortfall = shortfallDays.reduce(
		(total, day) => total + day.unfulfilledAmount,
		0,
	);
	const firstShortfallDate = shortfallDays[0]?.date
		? parseIsoDateLocal(shortfallDays[0].date)
		: undefined;
	const lastShortfallDate = shortfallDays[shortfallDays.length - 1]?.date
		? parseIsoDateLocal(shortfallDays[shortfallDays.length - 1].date)
		: undefined;

	return (
		<Card className="rounded-[1.6rem] border-border/80">
			<CardHeader>
				<div>
					<CardTitle>Underfulfillment calendar</CardTitle>
					<CardDescription>
						Dates where account constraints limit scheduled transactions. Select
						a highlighted day for movement detail.
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				{!fulfillment ? (
					<div className="rounded-2xl border border-border/80 bg-muted/40 px-4 py-6 type-body text-muted-foreground">
						Posting-fulfillment evaluation is unavailable.
					</div>
				) : shortfallDays.length > 0 ? (
					<div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
						<div className="rounded-2xl border border-border/80 bg-surface/75 p-3 dark:border-white/10 dark:bg-surface/55">
							<Calendar
								mode="single"
								selected={
									selectedDay ? parseIsoDateLocal(selectedDay.date) : undefined
								}
								defaultMonth={firstShortfallDate}
								startMonth={firstShortfallDate}
								endMonth={lastShortfallDate}
								numberOfMonths={2}
								disabled={(date) =>
									!shortfallDayByDate.has(formatIsoDateLocal(date))
								}
								modifiers={{ shortfall: shortfallDates }}
								modifiersClassNames={{
									shortfall:
										"[&_button]:border [&_button]:border-tertiary-border [&_button]:bg-tertiary-subtle [&_button]:font-semibold [&_button]:text-tertiary-foreground [&_button]:hover:bg-tertiary/15",
								}}
								onDayClick={(date, modifiers) => {
									if (modifiers.disabled) return;
									const isoDate = formatIsoDateLocal(date);
									if (shortfallDayByDate.has(isoDate))
										setSelectedDateIso(isoDate);
								}}
							/>
						</div>

						<div className="space-y-3 rounded-2xl border border-tertiary-border/80 bg-tertiary-subtle/80 p-4 shadow-inner shadow-white/20 dark:shadow-black/20">
							<div>
								<div className="text-xs font-medium uppercase tracking-[0.16em] text-tertiary-foreground">
									Underfulfilled dates
								</div>
								<div className="mt-1 type-metric text-tertiary-foreground">
									{currency.format(totalShortfall)}
								</div>
								<div className="type-caption text-tertiary-foreground/80">
									Total unfunded across {shortfallDays.length} date
									{shortfallDays.length === 1 ? "" : "s"}
								</div>
							</div>

							<div className="space-y-2">
								{shortfallDays.slice(0, 8).map((day) => (
									<button
										key={day.date}
										type="button"
										onClick={() => setSelectedDateIso(day.date)}
										className="w-full rounded-xl border border-border/80 bg-card/82 px-3 py-2 text-left shadow-sm transition hover:border-tertiary-border hover:bg-tertiary-subtle dark:border-white/10"
									>
										<div className="flex items-center justify-between gap-2">
											<span className="type-label text-tertiary-foreground">
												{day.label}
											</span>
											<span className="type-caption type-value font-semibold text-tertiary-foreground">
												{currency.format(day.unfulfilledAmount)}
											</span>
										</div>
										<div className="mt-1 type-caption text-tertiary-foreground/70">
											Requested {currency.format(day.requestedPostingAmount)}
											applied {currency.format(day.realizedPostingAmount)}
										</div>
									</button>
								))}
							</div>

							{shortfallDays.length > 8 ? (
								<div className="type-caption text-tertiary-foreground/70">
									Showing the first 8 shortfall dates. Use the calendar for
									later dates.
								</div>
							) : null}
						</div>
					</div>
				) : (
					<div className="rounded-2xl border border-primary-border/80 bg-primary-subtle/80 px-4 py-6 type-body text-primary">
						No posting requests are underfulfilled within the horizon.
					</div>
				)}
			</CardContent>

			{selectedDay ? (
				<Dialog
					ariaLabel={`Shortfall detail for ${selectedDay.label}`}
					onClose={() => setSelectedDateIso(null)}
					className="max-w-4xl rounded-[1.6rem] border border-border/80 bg-card p-5 shadow-2xl dark:border-white/10"
				>
					<div className="mb-4 flex items-start justify-between gap-4">
						<div>
							<div className="text-xs font-medium uppercase tracking-[0.16em] text-tertiary-foreground">
								Projected underfulfillment
							</div>
							<h3 className="mt-1 type-title">{selectedDay.label}</h3>
							<p className="mt-1 type-muted">
								{currency.format(selectedDay.unfulfilledAmount)} constrained on
								this date.
							</p>
						</div>
						<button
							type="button"
							onClick={() => setSelectedDateIso(null)}
							className="rounded-full border border-border px-3 py-1.5 type-label transition hover:border-ring hover:text-foreground"
						>
							Close
						</button>
					</div>

					<ShortfallDetailPanel
						periodStartDate={selectedDay.date}
						periodLabel={selectedDay.label}
						events={selectedEvents}
						rows={rows}
						postingById={postingById}
						accounts={accounts}
					/>
				</Dialog>
			) : null}
		</Card>
	);
});
