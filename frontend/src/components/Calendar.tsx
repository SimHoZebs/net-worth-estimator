import { useMemo } from "react";
import { dateLabel, money } from "../domain/format.ts";
import "./Calendar.css";

export interface CalendarEvent {
	date: string;
	label: string;
	amount: number;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthTitle(year: number, monthIndex: number): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, monthIndex, 1)));
}

function daysInMonth(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function toIso(year: number, monthIndex: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reusable month-grid calendar. Renders one grid per calendar month
 * intersecting the inclusive [start, end] window, with per-day totals for
 * the supplied events. Display-only: days are labeled for assistive
 * technology but carry no interaction.
 */
export function Calendar({
	start,
	end,
	events,
	todayIso,
	label,
}: {
	start: string;
	end: string;
	events: CalendarEvent[];
	todayIso: string;
	label: string;
}) {
	const months = useMemo(() => {
		const [startYear, startMonth] = start
			.slice(0, 7)
			.split("-")
			.map(Number) as [number, number];
		const [endYear, endMonth] = end.slice(0, 7).split("-").map(Number) as [
			number,
			number,
		];
		const list: { year: number; monthIndex: number }[] = [];
		let year = startYear;
		let month = startMonth - 1;
		while (year < endYear || (year === endYear && month <= endMonth - 1)) {
			list.push({ year, monthIndex: month });
			month += 1;
			if (month > 11) {
				month = 0;
				year += 1;
			}
		}
		return list;
	}, [start, end]);

	const byDay = useMemo(() => {
		const map = new Map<string, CalendarEvent[]>();
		for (const event of events) {
			if (event.date < start || event.date > end) continue;
			const existing = map.get(event.date);
			if (existing) existing.push(event);
			else map.set(event.date, [event]);
		}
		return map;
	}, [events, start, end]);

	const today = todayIso.slice(0, 10);
	return (
		<div className="calendar" role="img" aria-label={label}>
			{months.map(({ year, monthIndex }) => {
				const totalDays = daysInMonth(year, monthIndex);
				const leadBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
				const cells: (string | null)[] = [
					...Array<null>(leadBlanks).fill(null),
				];
				for (let day = 1; day <= totalDays; day++)
					cells.push(toIso(year, monthIndex, day));
				return (
					<section
						key={`${year}-${monthIndex}`}
						aria-label={monthTitle(year, monthIndex)}
					>
						<h4>{monthTitle(year, monthIndex)}</h4>
						<div className="calendar-grid">
							{WEEKDAYS.map((day) => (
								<span key={day} className="calendar-dow">
									{day}
								</span>
							))}
							{cells.map((date, index) => {
								if (!date)
									return (
										<span key={`blank-${index}`} className="calendar-blank" />
									);
								const dayEvents = byDay.get(date) ?? [];
								const total = dayEvents.reduce(
									(sum, event) => sum + event.amount,
									0,
								);
								const dayNumber = Number(date.slice(8, 10));
								const names = dayEvents.map((event) => event.label).join(", ");
								return (
									<div
										key={date}
										className={
											date === today
												? "calendar-cell calendar-today"
												: dayEvents.length
													? "calendar-cell calendar-has-events"
													: "calendar-cell"
										}
										{...(dayEvents.length > 0
											? {
													role: "img" as const,
													"aria-label": `${dateLabel(date, true)}, ${money(total)} in bills: ${names}`,
												}
											: {})}
									>
										<span className="calendar-day">{dayNumber}</span>
										{dayEvents.length > 0 && (
											<span className="calendar-total">{money(total)}</span>
										)}
									</div>
								);
							})}
						</div>
					</section>
				);
			})}
		</div>
	);
}
