import type { ReactNode } from "react";
import { mergeStyles } from "../mergeStyles.ts";
import { TableCell, TableHeader, TableRow } from "../DataTable.tsx";
import {
	movementIconStyles,
	transactionCellStyles,
	transactionRowStyles,
	type TransactionTone,
} from "./activityStyles.ts";

export type { TransactionTone } from "./activityStyles.ts";

export type TransactionItemSlots = {
	subtitle?: ReactNode;
	mobile?: ReactNode;
	badges?: ReactNode;
};

/**
 * Single visual transaction row. Domain mapping stays with the callers
 * (plan definitions vs projected occurrences); this owns only the shared
 * table layout, class names, and interaction shape.
 */
export function TransactionItemRow({
	date,
	icon,
	tone,
	title,
	amount,
	actionLabel,
	onSelect,
	selectDisabled = false,
	dimmed = false,
	slots,
}: {
	date: ReactNode;
	icon: ReactNode;
	tone: TransactionTone;
	title: string;
	amount: ReactNode;
	actionLabel: string;
	onSelect: () => void;
	selectDisabled?: boolean;
	dimmed?: boolean;
	slots?: TransactionItemSlots;
}) {
	return (
		<TableRow className={transactionRowStyles({ dimmed })}>
			<TableCell className={transactionCellStyles({ column: "date" })}>
				{date}
			</TableCell>
			<TableHeader
				scope="row"
				className={transactionCellStyles({ column: "name" })}
			>
				<button
					type="button"
					className="flex w-full items-center gap-3 rounded-control border-0 bg-transparent px-2 py-0.5 text-left [@media(max-width:600px)]:gap-2"
					aria-label={actionLabel}
					onClick={onSelect}
					disabled={selectDisabled}
				>
					<span
						className={mergeStyles(
							movementIconStyles({ tone }),
							"[@media(max-width:600px)]:hidden",
						)}
					>
						{icon}
					</span>
					<span className="flex min-w-0 flex-col gap-1">
						<strong className="text-xs font-semibold [overflow-wrap:anywhere]">
							{title}
						</strong>
						{slots?.subtitle && (
							<span className="text-xs text-muted">{slots.subtitle}</span>
						)}
						{slots?.mobile && (
							<span className="hidden text-xs text-muted [@media(max-width:600px)]:block">
								{slots.mobile}
							</span>
						)}
						{slots?.badges && (
							<span className="flex flex-wrap gap-1">{slots.badges}</span>
						)}
					</span>
				</button>
			</TableHeader>
			<TableCell className={transactionCellStyles({ column: "amount" })}>
				<span className="flex flex-col items-end gap-0.5">{amount}</span>
			</TableCell>
		</TableRow>
	);
}
