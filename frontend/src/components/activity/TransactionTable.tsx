import type { ReactNode } from "react";
import { DataTable } from "../DataTable.tsx";

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
}: {
	caption: string;
	showHeaders?: boolean;
	scrollId?: string;
	children: ReactNode;
}) {
	return (
		<DataTable
			className="account-activity-table"
			caption={caption}
			showHeaders={showHeaders}
			scrollId={scrollId}
			columns={[
				{ label: "Date", className: "transaction-date-column" },
				{ label: "Transaction" },
				{ label: "Amount", className: "transaction-amount-column" },
			]}
		>
			{children}
		</DataTable>
	);
}
