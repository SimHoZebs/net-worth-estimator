import type { ReactNode } from "react";
import { BusinessLogo } from "../BusinessLogo.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/lib/utils.ts";
import { TableCell, TableHead, TableRow } from "@/components/ui/table.tsx";
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
 *
 * Read-only records (such as derived statements) use the same layout and
 * styling but render no button, because there is nothing to open.
 */
export function TransactionItemRow({
	date,
	icon,
	businessKey,
	tone,
	title,
	amount,
	actionLabel,
	onSelect,
	selectDisabled = false,
	readOnly = false,
	dimmed = false,
	divider,
	dividerLabel,
	shortfall,
	slots,
}: {
	date: ReactNode;
	icon: ReactNode;
	/** Recognized personal-transaction mark; omitted rows keep their generic icon. */
	businessKey?: string;
	tone: TransactionTone;
	title: string;
	amount: ReactNode;
	/** Required for interactive rows; ignored when readOnly is set. */
	actionLabel?: string;
	/** Required for interactive rows; ignored when readOnly is set. */
	onSelect?: () => void;
	selectDisabled?: boolean;
	/** Render the name cell as static content with no button or handler. */
	readOnly?: boolean;
	dimmed?: boolean;
	divider?: "warning" | "danger";
	/** Centered in this row's existing divider, without a spacer row. */
	dividerLabel?: string;
	shortfall?: boolean;
	slots?: TransactionItemSlots;
}) {
	const nameContent = (
		<>
			<span
				data-transaction-icon
				className={cn(transactionIconStyles({ tone }), "relative")}
			>
				{businessKey ? (
					<BusinessLogo
						businessKey={businessKey}
						fallback={icon}
						size={16}
						onLightSurface
					/>
				) : (
					icon
				)}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<strong
					title={title}
					className="block min-w-0 truncate text-xs font-semibold sm:max-w-[48ch]"
				>
					{title}
				</strong>
				{slots?.subtitle && (
					<span className="block min-w-0 truncate text-xs text-muted-foreground sm:max-w-[32ch]">
						{slots.subtitle}
					</span>
				)}
				{slots?.mobile && (
					<span
						data-transaction-mobile
						className="hidden min-w-0 whitespace-normal break-words text-xs text-muted-foreground max-sm:block"
					>
						{slots.mobile}
					</span>
				)}
				{slots?.badges && (
					<span className="flex flex-wrap gap-1">{slots.badges}</span>
				)}
			</span>
		</>
	);
	return (
		<TableRow
			className={cn(
				transactionRowStyles({ dimmed, divider }),
				dividerLabel && "relative border-b-0",
				shortfall && transactionShortfallRowStyles(),
			)}
		>
			<TableCell className={transactionCellStyles({ column: "date" })}>
				{date}
			</TableCell>
			<TableHead
				scope="row"
				className={transactionCellStyles({ column: "name" })}
			>
				{readOnly ? (
					<div className="flex w-full items-center gap-3 px-2 py-1 text-left max-sm:gap-2 max-sm:px-0">
						{nameContent}
					</div>
				) : (
					<Button
						type="button"
						variant="ghost"
						className="h-auto w-full items-center justify-start gap-3 px-2 py-1 text-left has-disabled:opacity-60 max-sm:gap-2 max-sm:px-0"
						aria-label={actionLabel}
						onClick={onSelect}
						disabled={selectDisabled}
					>
						{nameContent}
					</Button>
				)}
			</TableHead>
			<TableCell className={transactionCellStyles({ column: "amount" })}>
				<span className="flex flex-col items-end gap-0.5">{amount}</span>
				{divider && dividerLabel && (
					<span
						data-spending-divider={divider}
						className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex translate-y-1/2 items-center gap-3"
					>
						<span
							aria-hidden="true"
							className={cn(
								"flex-1 border-t-2",
								divider === "danger"
									? "border-danger-text"
									: "[border-top-style:dashed] border-warning-text",
							)}
						/>
						<span
							className={cn(
								"text-xs font-semibold whitespace-nowrap",
								divider === "danger" ? "text-danger-text" : "text-warning-text",
							)}
						>
							{dividerLabel}
						</span>
						<span
							aria-hidden="true"
							className={cn(
								"flex-1 border-t-2",
								divider === "danger"
									? "border-danger-text"
									: "[border-top-style:dashed] border-warning-text",
							)}
						/>
					</span>
				)}
			</TableCell>
		</TableRow>
	);
}
