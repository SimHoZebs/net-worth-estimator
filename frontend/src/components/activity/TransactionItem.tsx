import type { ReactNode } from "react";
import { mergeStyles } from "../mergeStyles.ts";
import { TableCell, TableHeader, TableRow } from "../DataTable.tsx";
import {
	transactionIconStyles,
	transactionCellStyles,
	transactionRowStyles,
	transactionShortfallRowStyles,
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
 * (saved definitions vs projected occurrences); this owns only the shared
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
	divider,
	shortfall,
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
	divider?: "warning" | "danger";
	shortfall?: boolean;
	slots?: TransactionItemSlots;
}) {
	return (
		<TableRow
			className={mergeStyles(
				transactionRowStyles({ dimmed, divider }),
				shortfall && transactionShortfallRowStyles(),
			)}
		>
			<TableCell className={transactionCellStyles({ column: "date" })}>
				{date}
			</TableCell>
			<TableHeader
				scope="row"
				className={transactionCellStyles({ column: "name" })}
			>
				<button
					type="button"
					className="flex w-full items-center gap-3 rounded-control border-0 bg-transparent text-left max-sm:gap-2"
					aria-label={actionLabel}
					onClick={onSelect}
					disabled={selectDisabled}
				>
					<span
						className={mergeStyles(
							transactionIconStyles({ tone }),
							"max-sm:hidden",
						)}
					>
						{icon}
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<strong
							title={title}
							className="block max-w-[48ch] truncate text-xs font-semibold max-sm:max-w-[calc(100vw_-_13rem)]"
						>
							{title}
						</strong>
						{slots?.subtitle && (
							<span className="block max-w-[32ch] truncate text-xs text-muted max-sm:max-w-[calc(100vw_-_13rem)]">
								{slots.subtitle}
							</span>
						)}
						{slots?.mobile && (
							<span className="hidden text-xs text-muted max-sm:block">
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
