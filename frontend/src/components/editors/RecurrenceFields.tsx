import { useState } from "react";
import { isIsoDate } from "../../domain/format.ts";
import {
	dayOfMonthOfIsoDate,
	monthAnchorOfStartDate,
	validateRecurrence,
	weekdayOfIsoDate,
	WEEKDAY_TOGGLE_LABELS,
	type Recurrence,
	type RecurrenceUnit,
} from "../../domain/recurrence.ts";
import { parseUnion } from "../../domain/guards.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	FieldDescription,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { EditorField, EditorSelect } from "./editorFields.tsx";

const WEEKDAY_FULL_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

const UNIT_OPTIONS = [
	{ value: "day", label: "Day(s)" },
	{ value: "week", label: "Week(s)" },
	{ value: "month", label: "Month(s)" },
	{ value: "year", label: "Year(s)" },
] as const;

const NTH_WORDS = ["first", "second", "third", "fourth", "fifth"] as const;

/**
 * Google Calendar Custom-style repeat controls, shared by the create
 * schedule dialog and the in-place schedule editor. The parent owns the
 * recurrence value; this control only reports changes and never submits.
 */
export function RecurrenceFields({
	recurrence,
	startDate,
	onChange,
	disabled,
	compact,
	idPrefix,
}: {
	recurrence: Recurrence;
	startDate: string;
	onChange: (next: Recurrence) => void;
	disabled?: boolean;
	/** Tighter spacing for the in-place editor. */
	compact?: boolean;
	idPrefix: string;
}) {
	const startWeekday = isIsoDate(startDate)
		? weekdayOfIsoDate(startDate)
		: null;
	// Interval edits stay local text until they parse to 1..99, so clearing
	// the field never snaps back mid-keystroke. An external interval change
	// resets the draft during render.
	const [intervalText, setIntervalText] = useState<string | null>(null);
	const [lastInterval, setLastInterval] = useState(recurrence.interval);
	if (lastInterval !== recurrence.interval) {
		setLastInterval(recurrence.interval);
		setIntervalText(null);
	}
	const shownInterval = intervalText ?? String(recurrence.interval);
	const intervalError =
		intervalText !== null && !/^([1-9]|[1-9][0-9])$/.test(intervalText.trim())
			? "Enter a repeat interval from 1 to 99."
			: null;

	const intervalId = `${idPrefix}-interval`;
	const intervalHintId = `${intervalId}-hint`;
	const unitId = `${idPrefix}-unit`;
	const repeatOnHintId = `${idPrefix}-repeat-on-hint`;
	const monthlyHintId = `${idPrefix}-monthly-hint`;

	const changeUnit = (unit: RecurrenceUnit) => {
		if (unit === recurrence.unit) return;
		if (unit === "week") {
			const days =
				recurrence.weekdays?.filter(
					(day) => Number.isInteger(day) && day >= 0 && day <= 6,
				) ?? [];
			onChange({
				unit,
				interval: recurrence.interval,
				weekdays:
					days.length > 0
						? [...new Set(days)].sort((a, b) => a - b)
						: [startWeekday ?? 1],
			});
			return;
		}
		if (unit === "month") {
			onChange({
				unit,
				interval: recurrence.interval,
				monthlyMode: recurrence.monthlyMode ?? "byDate",
			});
			return;
		}
		onChange({ unit, interval: recurrence.interval });
	};

	const toggleWeekday = (day: number) => {
		if (disabled) return;
		const days = new Set(recurrence.weekdays ?? []);
		if (days.has(day)) {
			// The start weekday anchors the series and always stays selected.
			if (day === startWeekday) return;
			days.delete(day);
			if (days.size === 0) return;
		} else {
			days.add(day);
		}
		onChange({
			...recurrence,
			weekdays: [...days].sort((a, b) => a - b),
		});
	};

	const invalid = validateRecurrence(recurrence, startDate);
	// The controls state the cadence outright, so only validation errors
	// get a live summary line; the sentence and date preview are gone.
	const error = intervalError ?? invalid;
	const dayOfMonth = isIsoDate(startDate)
		? dayOfMonthOfIsoDate(startDate)
		: null;
	const anchor =
		recurrence.unit === "month" ? monthAnchorOfStartDate(startDate) : null;
	const nthWord =
		anchor !== null
			? anchor.isLast
				? "last"
				: (NTH_WORDS[anchor.nth - 1] ?? `${anchor.nth}th`)
			: null;

	return (
		<div className={compact ? "flex flex-col gap-3" : "flex flex-col gap-4"}>
			<div className="grid grid-cols-2 gap-2">
				<EditorField label="Repeat every" htmlFor={intervalId}>
					<Input
						id={intervalId}
						type="number"
						required
						min="1"
						max="99"
						step="1"
						value={shownInterval}
						disabled={disabled}
						aria-describedby={intervalHintId}
						onChange={(event) => {
							const text = event.target.value;
							setIntervalText(text);
							const parsed = Number(text);
							if (
								text.trim() !== "" &&
								Number.isInteger(parsed) &&
								parsed >= 1 &&
								parsed <= 99
							)
								onChange({ ...recurrence, interval: parsed });
						}}
					/>
				</EditorField>
				<EditorField label="Repeat unit" htmlFor={unitId}>
					<EditorSelect
						id={unitId}
						value={recurrence.unit}
						onValueChange={(next) => {
							const parsed = parseUnion(next, [
								"day",
								"week",
								"month",
								"year",
							] as const);
							if (parsed) changeUnit(parsed);
						}}
						options={[...UNIT_OPTIONS]}
						disabled={disabled}
					/>
				</EditorField>
			</div>
			<p id={intervalHintId} className="sr-only">
				Repeat every 1 to 99 units.
			</p>
			{recurrence.unit === "week" && (
				<FieldSet>
					<FieldLegend variant="label">Repeat on</FieldLegend>
					<div className="flex flex-wrap gap-1">
						{WEEKDAY_TOGGLE_LABELS.map((label, day) => {
							const selected = (recurrence.weekdays ?? []).includes(day);
							const isStart = day === startWeekday;
							return (
								<Button
									key={day}
									type="button"
									variant={selected ? "default" : "outline"}
									size="icon-sm"
									aria-pressed={selected}
									aria-label={WEEKDAY_FULL_NAMES[day]}
									aria-describedby={repeatOnHintId}
									title={
										isStart && selected
											? `${WEEKDAY_FULL_NAMES[day]} (first occurrence, always included)`
											: WEEKDAY_FULL_NAMES[day]
									}
									disabled={disabled || (isStart && selected)}
									onClick={() => toggleWeekday(day)}
								>
									{label}
								</Button>
							);
						})}
					</div>
					<FieldDescription id={repeatOnHintId}>
						Includes the first occurrence weekday.
					</FieldDescription>
				</FieldSet>
			)}
			{recurrence.unit === "month" && (
				<FieldSet>
					<FieldLegend variant="label">Monthly repeat</FieldLegend>
					<RadioGroup
						value={recurrence.monthlyMode ?? "byDate"}
						disabled={disabled}
						aria-describedby={
							dayOfMonth !== null && dayOfMonth > 28 ? monthlyHintId : undefined
						}
						onValueChange={(value) => {
							const parsed = parseUnion(value, [
								"byDate",
								"byNthWeekday",
							] as const);
							if (parsed) onChange({ ...recurrence, monthlyMode: parsed });
						}}
					>
						<Field orientation="horizontal">
							<RadioGroupItem
								value="byDate"
								id={`${idPrefix}-monthly-by-date`}
							/>
							<FieldLabel htmlFor={`${idPrefix}-monthly-by-date`}>
								Monthly on day {dayOfMonth !== null ? dayOfMonth : "–"}
							</FieldLabel>
						</Field>
						<Field orientation="horizontal">
							<RadioGroupItem
								value="byNthWeekday"
								id={`${idPrefix}-monthly-by-nth`}
							/>
							<FieldLabel htmlFor={`${idPrefix}-monthly-by-nth`}>
								{anchor !== null && nthWord !== null
									? `Monthly on the ${nthWord} ${WEEKDAY_FULL_NAMES[anchor.weekday]}`
									: "Monthly on the same weekday"}
							</FieldLabel>
						</Field>
					</RadioGroup>
					{dayOfMonth !== null && dayOfMonth > 28 && (
						<FieldDescription id={monthlyHintId}>
							Months without that day use the last day.
						</FieldDescription>
					)}
				</FieldSet>
			)}
			{error !== null && (
				<div aria-live="polite">
					<p className="m-0 text-sm text-destructive">{error}</p>
				</div>
			)}
		</div>
	);
}
