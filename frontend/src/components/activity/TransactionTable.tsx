import type { ComponentProps } from "react";
import { DataTable } from "../DataTable.tsx";
import { mergeStyles } from "../mergeStyles.ts";
import { transactionCellStyles } from "./activityStyles.ts";

/**
 * The single account-activity table: date, transaction, amount. Headers are
 * opt-in and hidden by default; the sr-only caption keeps the table named
 * for assistive technology.
 *
 * The layout is fixed with the date and amount columns sized to their
 * content and the transaction column taking the remainder, so long titles
 * truncate inside their column instead of forcing the table wider than its
 * container. Transaction rows never need horizontal scrolling.
 */
export function TransactionTable({
	caption,
	showHeaders = false,
	scrollId,
	children,
	className,
	...props
}: Omit<ComponentProps<typeof DataTable>, "columns" | "colgroup">) {
	return (
		<DataTable
			{...props}
			className={mergeStyles("border-t border-line table-fixed", className)}
			caption={caption}
			showHeaders={showHeaders}
			scrollId={scrollId}
			// Fixed column widths keep the table at its container width:
			// the date and amount columns hold their content while the
			// transaction column takes the remainder, so long titles
			// truncate instead of forcing horizontal scrolling. Hiding the
			// date column (not just its cells) keeps the remaining columns
			// aligned with their cells on small screens.
			colgroup={
				<colgroup>
					<col className="w-24 max-sm:hidden" />
					<col />
					<col className="w-36 max-sm:w-28" />
				</colgroup>
			}
			columns={[
				{
					label: "Date",
					className: `${transactionCellStyles({ column: "date" })} pl-3`,
				},
				{
					label: "Transaction",
					className: transactionCellStyles({ column: "name" }),
				},
				{
					label: "Amount",
					className: transactionCellStyles({ column: "amount" }),
				},
			]}
		>
			{children}
		</DataTable>
	);
}
