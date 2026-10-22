import type { ComponentProps } from "react";
import { DataTable } from "../DataTable.tsx";
import { mergeStyles } from "../mergeStyles.ts";
import { transactionCellStyles } from "./activityStyles.ts";

/**
 * The single account-activity table: date, transaction, amount. Headers are
 * opt-in and hidden by default; the sr-only caption keeps the table named
 * for assistive technology.
 */
export function TransactionTable({
	caption,
	showHeaders = false,
	scrollId,
	children,
	className,
	...props
}: Omit<ComponentProps<typeof DataTable>, "columns">) {
	return (
		<DataTable
			{...props}
			className={mergeStyles("border-t border-line", className)}
			caption={caption}
			showHeaders={showHeaders}
			scrollId={scrollId}
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
