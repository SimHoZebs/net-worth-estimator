import {
	CalendarClock,
	CalendarDays,
	CircleHelp,
	Clock3,
	PauseCircle,
} from "lucide-react";
import { dateLabel } from "../../domain/format.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";

export function PurchaseStatus({
	item,
	compact = false,
}: {
	item: PurchaseViewItem;
	compact?: boolean;
}) {
	const { outcome } = item;
	let icon = <Clock3 size={14} aria-hidden="true" />;
	let label = "Calculating date";
	let tone = "text-muted";

	switch (outcome.kind) {
		case "scheduled":
			icon = <CalendarDays size={14} aria-hidden="true" />;
			label = `${dateLabel(outcome.date, true)} · Auto`;
			tone = "text-success-text";
			break;
		case "not-scheduled":
			icon = <CircleHelp size={14} aria-hidden="true" />;
			label = "No date in forecast";
			tone = "text-warning-text";
			break;
		case "excluded":
			icon = <PauseCircle size={14} aria-hidden="true" />;
			label = "Excluded";
			break;
		case "pending":
			icon = <CalendarClock size={14} aria-hidden="true" />;
			label = "Calculating date";
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
