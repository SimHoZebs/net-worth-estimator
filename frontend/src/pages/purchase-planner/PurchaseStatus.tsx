import {
	AlertTriangle,
	CalendarClock,
	CalendarDays,
	CircleHelp,
	Clock3,
	LockKeyhole,
	PauseCircle,
} from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";

export function PurchaseStatus({
	item,
	compact = false,
}: {
	item: PurchaseViewItem;
	compact?: boolean;
}) {
	const { outcome, timing } = item;
	let icon = <Clock3 size={14} aria-hidden="true" />;
	let label = "Calculating date";
	let tone = "text-muted";

	switch (outcome.kind) {
		case "scheduled":
			icon =
				timing.kind === "fixed" ? (
					<LockKeyhole size={14} aria-hidden="true" />
				) : (
					<CalendarDays size={14} aria-hidden="true" />
				);
			label = `${dateLabel(outcome.date, true)} · ${timing.kind === "fixed" ? "Fixed" : "Auto"}`;
			tone = "text-success-text";
			break;
		case "fixed-conflict":
			icon = <AlertTriangle size={14} aria-hidden="true" />;
			label = `${dateLabel(outcome.date, true)} · Fixed · ${outcome.shortfall === undefined ? "Funding conflict" : `${money(outcome.shortfall)} short`}`;
			tone = "text-danger-text";
			break;
		case "not-scheduled":
			icon =
				outcome.reason === "priority-blocked" ? (
					<PauseCircle size={14} aria-hidden="true" />
				) : (
					<CircleHelp size={14} aria-hidden="true" />
				);
			label =
				outcome.reason === "priority-blocked"
					? "Waiting on higher priority"
					: "No date in forecast";
			tone = "text-warning-text";
			break;
		case "excluded":
			icon = <PauseCircle size={14} aria-hidden="true" />;
			label = "Excluded";
			break;
		case "pending":
			icon = <CalendarClock size={14} aria-hidden="true" />;
			label =
				timing.kind === "fixed"
					? "Fixed date · Awaiting evaluation"
					: "Calculating date";
			break;
	}

	return (
		<span
			className={`inline-flex min-w-0 items-center gap-2 text-xs ${tone}`}
			title={label}
		>
			{icon}
			<span className={compact ? "truncate" : "break-words"}>{label}</span>
		</span>
	);
}
