import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button.tsx";
import { Calendar } from "@/components/ui/calendar.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
	FLOW_RANGE_PRESETS,
	flowPresetRange,
	matchFlowPreset,
	type FlowRangePresetId,
} from "../../domain/flowWindow.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
import { useMediaQuery, viewportQueries } from "../../state/useMediaQuery.ts";

function isoToLocalDate(iso: string): Date {
	const parts = iso.split("-").map(Number);
	const year = parts[0] ?? 1970;
	const month = parts[1] ?? 1;
	const day = parts[2] ?? 1;
	return new Date(year, month - 1, day, 12, 0, 0);
}

function localDateToIso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function isoWindowToDraft(startDate: string, endDate: string): DateRange {
	return {
		from: isoToLocalDate(startDate),
		to: isoToLocalDate(endDate),
	};
}

/**
 * Money-flow date range picker. The trigger names the matched preset or
 * the custom window; the panel pairs the shared preset list with a
 * canonical range Calendar and an Apply/Cancel footer. Wide screens anchor
 * a Popover; small screens use a modal Dialog.
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
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<DateRange | undefined>(() =>
		isoWindowToDraft(startDate, endDate),
	);
	const compact = useMediaQuery(viewportQueries.belowSm);

	const today = todayIso();
	const matched = matchFlowPreset({ startDate, endDate }, today);
	const label =
		FLOW_RANGE_PRESETS.find((preset) => preset.id === matched)?.label ??
		`${dateLabel(startDate, true)} – ${dateLabel(endDate, true)}`;

	const draftStartIso = draft?.from ? localDateToIso(draft.from) : null;
	const draftEndIso = draft?.to ? localDateToIso(draft.to) : null;
	const draftMatched =
		draftStartIso && draftEndIso
			? matchFlowPreset(
					{ startDate: draftStartIso, endDate: draftEndIso },
					today,
				)
			: null;

	const openPanel = () => {
		setDraft(isoWindowToDraft(startDate, endDate));
		setOpen(true);
	};

	const closePanel = () => {
		setOpen(false);
	};

	const choosePreset = (id: FlowRangePresetId) => {
		onApply(flowPresetRange(id, todayIso()));
		setOpen(false);
	};

	const applyDraft = () => {
		const fromIso = draftStartIso ?? startDate;
		const toIso = draftEndIso ?? fromIso;
		const start = fromIso <= toIso ? fromIso : toIso;
		const end = fromIso <= toIso ? toIso : fromIso;
		onApply({ startDate: start, endDate: end });
		setOpen(false);
	};

	const selectDraft = (next: DateRange | undefined) => {
		if (next?.from) setDraft(next);
	};

	const trigger = (
		<Button
			type="button"
			variant="outline"
			aria-label={`Date range: ${label}`}
			aria-describedby={captionId}
			className="w-full justify-between"
		>
			<span className="min-w-0 flex-1 truncate text-left">{label}</span>
			<ChevronDown size={16} aria-hidden="true" className="flex-none" />
		</Button>
	);

	const panel = (
		<>
			<div className="flex gap-4 max-sm:flex-col">
				<div
					role="group"
					aria-label="Date range presets"
					className="flex w-36 flex-none flex-col gap-1 max-sm:w-auto max-sm:flex-row max-sm:flex-wrap"
				>
					{FLOW_RANGE_PRESETS.map((preset) => (
						<Button
							key={preset.id}
							type="button"
							variant={draftMatched === preset.id ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={draftMatched === preset.id}
							onClick={() => choosePreset(preset.id)}
							className="justify-start"
						>
							{preset.label}
						</Button>
					))}
				</div>
				<Calendar
					mode="range"
					numberOfMonths={compact ? 1 : 2}
					defaultMonth={draft?.from ?? isoToLocalDate(startDate)}
					selected={draft}
					onSelect={selectDraft}
				/>
			</div>
			<DialogFooter className="mt-4">
				<Button variant="secondary" size="sm" onClick={closePanel}>
					Cancel
				</Button>
				<Button variant="default" size="sm" onClick={applyDraft}>
					Apply
				</Button>
			</DialogFooter>
		</>
	);

	return (
		<div className="flex min-w-0 w-fit max-w-full flex-col gap-1">
			<span id={captionId} className="text-xs text-muted-foreground">
				Date range
			</span>
			{compact ? (
				<Dialog
					open={open}
					onOpenChange={(next) => {
						if (next) openPanel();
						else closePanel();
					}}
				>
					<DialogTrigger render={trigger} />
					<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
						<DialogHeader>
							<DialogTitle>Choose date range</DialogTitle>
						</DialogHeader>
						{panel}
					</DialogContent>
				</Dialog>
			) : (
				<Popover
					open={open}
					onOpenChange={(next) => {
						if (next) openPanel();
						else closePanel();
					}}
				>
					<PopoverTrigger render={trigger} />
					<PopoverContent align="start" className="w-auto">
						{panel}
					</PopoverContent>
				</Popover>
			)}
		</div>
	);
}
