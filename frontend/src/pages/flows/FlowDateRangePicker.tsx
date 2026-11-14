import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "../../components/Button.tsx";
import { controlStyles } from "../../components/fieldStyles.ts";
import { mergeStyles } from "../../components/mergeStyles.ts";
import { Modal } from "../../components/Modal.tsx";
import {
	supportsPopover,
	useAnchoredPopover,
} from "../../components/popoverAnchor.ts";
import { SegmentedControl, segmentedPillStyles } from "../../components/SegmentedControl.tsx";
import {
	FLOW_RANGE_PRESETS,
	flowPresetRange,
	matchFlowPreset,
	type FlowRangePresetId,
} from "../../domain/flowWindow.ts";
import { dateLabel, isoDate, todayIso, utcDate } from "../../domain/format.ts";
import {
	useMediaQuery,
	viewportQueries,
} from "../../state/useMediaQuery.ts";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthTitle(year: number, monthIndex: number): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, monthIndex, 1)));
}

function monthOf(iso: string): { year: number; month: number } {
	const date = utcDate(iso);
	return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function shiftMonth(
	current: { year: number; month: number },
	delta: number,
): { year: number; month: number } {
	const total = current.year * 12 + current.month + delta;
	return {
		year: Math.floor(total / 12),
		month: ((total % 12) + 12) % 12,
	};
}

function toDayIso(year: number, monthIndex: number, day: number): string {
	return isoDate(new Date(Date.UTC(year, monthIndex, day, 12, 0, 0)));
}

function MonthCalendar({
	year,
	monthIndex,
	draftStart,
	draftEnd,
	onPrev,
	onNext,
	onDay,
}: {
	year: number;
	monthIndex: number;
	draftStart: string;
	draftEnd: string;
	onPrev: () => void;
	onNext: () => void;
	onDay: (iso: string) => void;
}) {
	const title = monthTitle(year, monthIndex);
	const totalDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
	const leadBlanks = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
	const cells: (string | null)[] = [
		...Array<null>(leadBlanks).fill(null),
	];
	for (let day = 1; day <= totalDays; day++)
		cells.push(toDayIso(year, monthIndex, day));
	while (cells.length % 7 !== 0) cells.push(null);
	return (
		<section aria-label={title} className="min-w-0 flex-1">
			<div className="mb-2 flex items-center justify-between gap-2">
				<IconButton
					icon={ChevronLeft}
					label={`Previous month (${title})`}
					size="sm"
					iconSize={16}
					onClick={onPrev}
				/>
				<h3 className="m-0 min-w-0 flex-1 truncate text-center text-xs font-semibold text-ink">
					{title}
				</h3>
				<IconButton
					icon={ChevronRight}
					label={`Next month (${title})`}
					size="sm"
					iconSize={16}
					onClick={onNext}
				/>
			</div>
			<div className="grid grid-cols-7 gap-1">
				{WEEKDAYS.map((day) => (
					<span
						key={day}
						className="pb-0.5 text-center text-xs font-bold text-muted"
					>
						{day}
					</span>
				))}
				{cells.map((date, index) =>
					date === null ? (
						<span key={`blank-${index}`} className="min-h-9" />
					) : (
						<button
							key={date}
							type="button"
							aria-label={dateLabel(date, true)}
							aria-pressed={date >= draftStart && date <= draftEnd}
							onClick={() => onDay(date)}
							className="min-h-9 rounded-control border border-transparent bg-transparent px-1 py-1 text-center text-sm text-ink hover:bg-hover aria-pressed:bg-surface-3 aria-pressed:font-bold pointer-coarse:min-h-12"
						>
							{Number(date.slice(8, 10))}
						</button>
					),
				)}
			</div>
		</section>
	);
}

/**
 * AWS-style money-flow date range picker. The trigger names the matched
 * preset or the custom window; the dialog pairs the shared preset list
 * with month grids and an Apply/Cancel footer. Wide screens show two
 * independently navigated grids; small screens show one grid at a time
 * behind Start/End tabs.
 */
export function FlowDateRangePicker({
	startDate,
	endDate,
	onApply,
}: {
	startDate: string;
	endDate: string;
	onApply: (range: { startDate: string; endDate: string }) => void;
}) {
	const captionId = useId();
	const triggerId = useId();
	const panelId = useId();
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [draftStart, setDraftStart] = useState(startDate);
	const [draftEnd, setDraftEnd] = useState(endDate);
	const [awaitingSecond, setAwaitingSecond] = useState(false);
	const [leftMonth, setLeftMonth] = useState(() => monthOf(startDate));
	const [rightMonth, setRightMonth] = useState(() => monthOf(endDate));
	const [compactMonth, setCompactMonth] = useState<"start" | "end">("start");
	const compact = useMediaQuery(viewportQueries.belowSm);

	const today = todayIso();
	const matched = matchFlowPreset({ startDate, endDate }, today);
	const label =
		FLOW_RANGE_PRESETS.find((preset) => preset.id === matched)?.label ??
		`${dateLabel(startDate, true)} – ${dateLabel(endDate, true)}`;
	const draftMatched = matchFlowPreset(
		{ startDate: draftStart, endDate: draftEnd },
		today,
	);

	const focusPresets = () => {
		const root = popoverRef.current;
		if (!root) return;
		const group = root.querySelector(
			'[role="group"][aria-label="Date range presets"]',
		);
		if (!group) return;
		const pressed = group.querySelector<HTMLElement>(
			'button[aria-pressed="true"]',
		);
		const fallback = group.querySelector<HTMLElement>("button");
		(pressed ?? fallback)?.focus({ preventScroll: true });
	};

	useAnchoredPopover({
		open,
		triggerRef,
		popoverRef,
		width: 640,
		onClose: () => {
			setOpen(false);
			triggerRef.current?.focus();
		},
		onOpenFocus: focusPresets,
	});

	useEffect(() => {
		if (open) focusPresets();
	}, [open]);

	const openPanel = () => {
		setDraftStart(startDate);
		setDraftEnd(endDate);
		setAwaitingSecond(false);
		setCompactMonth("start");
		const left = monthOf(startDate);
		const end = monthOf(endDate);
		setLeftMonth(left);
		setRightMonth(
			end.year === left.year && end.month === left.month
				? shiftMonth(left, 1)
				: end,
		);
		setOpen(true);
	};

	const closeToTrigger = () => {
		setOpen(false);
		triggerRef.current?.focus();
	};

	const choosePreset = (id: FlowRangePresetId) => {
		onApply(flowPresetRange(id, todayIso()));
		closeToTrigger();
	};

	const clickDay = (iso: string) => {
		if (!awaitingSecond) {
			setDraftStart(iso);
			setDraftEnd(iso);
			setAwaitingSecond(true);
			return;
		}
		if (iso < draftStart) {
			setDraftStart(iso);
			setDraftEnd(draftStart);
		} else {
			setDraftEnd(iso);
		}
		setAwaitingSecond(false);
	};

	const applyDraft = () => {
		const start = draftStart <= draftEnd ? draftStart : draftEnd;
		const end = draftStart <= draftEnd ? draftEnd : draftStart;
		onApply({ startDate: start, endDate: end });
		closeToTrigger();
	};

	const panel = (
		<>
			<div className="flex gap-4 max-sm:flex-col">
				<div
					role="group"
					aria-label="Date range presets"
					className="flex w-36 flex-none flex-col gap-1 max-sm:w-auto max-sm:flex-row max-sm:flex-wrap"
				>
					{FLOW_RANGE_PRESETS.map((preset) => (
						<button
							key={preset.id}
							type="button"
							aria-pressed={draftMatched === preset.id}
							onClick={() => choosePreset(preset.id)}
							className={segmentedPillStyles}
						>
							{preset.label}
						</button>
					))}
				</div>
				<div className="flex min-w-0 flex-1 gap-4 max-sm:flex-col">
					{compact ? (
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<SegmentedControl
								items={[
									{ value: "start", label: "Start" },
									{ value: "end", label: "End" },
								]}
								value={compactMonth}
								onChange={setCompactMonth}
								ariaLabel="Start or end month"
							/>
							{compactMonth === "start" ? (
								<MonthCalendar
									year={leftMonth.year}
									monthIndex={leftMonth.month}
									draftStart={draftStart <= draftEnd ? draftStart : draftEnd}
									draftEnd={draftStart <= draftEnd ? draftEnd : draftStart}
									onPrev={() => setLeftMonth((value) => shiftMonth(value, -1))}
									onNext={() => setLeftMonth((value) => shiftMonth(value, 1))}
									onDay={clickDay}
								/>
							) : (
								<MonthCalendar
									year={rightMonth.year}
									monthIndex={rightMonth.month}
									draftStart={draftStart <= draftEnd ? draftStart : draftEnd}
									draftEnd={draftStart <= draftEnd ? draftEnd : draftStart}
									onPrev={() => setRightMonth((value) => shiftMonth(value, -1))}
									onNext={() => setRightMonth((value) => shiftMonth(value, 1))}
									onDay={clickDay}
								/>
							)}
						</div>
					) : (
						<>
							<MonthCalendar
								year={leftMonth.year}
								monthIndex={leftMonth.month}
								draftStart={draftStart <= draftEnd ? draftStart : draftEnd}
								draftEnd={draftStart <= draftEnd ? draftEnd : draftStart}
								onPrev={() => setLeftMonth((value) => shiftMonth(value, -1))}
								onNext={() => setLeftMonth((value) => shiftMonth(value, 1))}
								onDay={clickDay}
							/>
							<MonthCalendar
								year={rightMonth.year}
								monthIndex={rightMonth.month}
								draftStart={draftStart <= draftEnd ? draftStart : draftEnd}
								draftEnd={draftStart <= draftEnd ? draftEnd : draftStart}
								onPrev={() => setRightMonth((value) => shiftMonth(value, -1))}
								onNext={() => setRightMonth((value) => shiftMonth(value, 1))}
								onDay={clickDay}
							/>
						</>
					)}
				</div>
			</div>
			<div className="mt-4 flex justify-end gap-2">
				<Button variant="secondary" size="sm" onClick={closeToTrigger}>
					Cancel
				</Button>
				<Button variant="primary" size="sm" onClick={applyDraft}>
					Apply
				</Button>
			</div>
		</>
	);

	return (
		<div className="flex min-w-0 w-fit max-w-full flex-col gap-1">
			<span id={captionId} className="text-xs text-muted">
				Date range
			</span>
			<button
				ref={triggerRef}
				id={triggerId}
				type="button"
				aria-label={`Date range: ${label}`}
				aria-describedby={captionId}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open && !compact ? panelId : undefined}
				onClick={() => (open ? closeToTrigger() : openPanel())}
				className={mergeStyles(
					controlStyles({ kind: "select" }),
					"flex items-center gap-2 text-left",
				)}
			>
				<span className="min-w-0 flex-1 truncate">{label}</span>
				<ChevronDown
					size={16}
					aria-hidden="true"
					className="flex-none text-muted"
				/>
			</button>
			{open && compact && (
				<Modal
					title="Choose date range"
					titleSize="plain"
					onClose={closeToTrigger}
				>
					{panel}
				</Modal>
			)}
			{open && !compact && (
				<div
					ref={popoverRef}
					id={panelId}
					role="dialog"
					aria-label="Choose date range"
					popover={supportsPopover() ? "auto" : undefined}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						closeToTrigger();
					}}
					className="m-0 z-(--z-menu) rounded-surface border border-solid border-line bg-surface p-4 shadow-overlay"
				>
					{panel}
				</div>
			)}
		</div>
	);
}
