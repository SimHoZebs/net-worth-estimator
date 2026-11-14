import type { ComponentProps, ReactNode } from "react";
import {
	Table,
	TableBody,
	TableCaption,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import { cn } from "@/lib/utils.ts";
import { transactionCellStyles } from "./activityStyles.ts";

/**
 * The single account-activity table: date, transaction, amount. Headers are
 * opt-in and hidden by default; the sr-only caption keeps the table named
 * for assistive technology.
 *
 * Scroll ownership and keyboard panning live in the canonical Table
 * container; this composes only the activity columns, caption, and headers.
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
}: {
	caption: string;
	showHeaders?: boolean;
	scrollId?: string;
	children: ReactNode;
	className?: string;
} & Omit<ComponentProps<"table">, "children">) {
	return (
		<Table
			{...props}
			containerProps={{ id: scrollId, role: "region", "aria-label": caption }}
			className={cn("border-t border-border table-fixed", className)}
		>
			<TableCaption className={showHeaders ? undefined : "sr-only"}>
				{caption}
			</TableCaption>
			<colgroup>
				<col className="w-24 max-sm:hidden" />
				<col />
				<col className="w-36 max-sm:w-28" />
			</colgroup>
			{showHeaders && (
				<TableHeader>
					<TableRow>
						<TableHead
							scope="col"
							className={cn(transactionCellStyles({ column: "date" }), "pl-3")}
						>
							Date
						</TableHead>
						<TableHead
							scope="col"
							className={transactionCellStyles({ column: "name" })}
						>
							Transaction
						</TableHead>
						<TableHead
							scope="col"
							className={transactionCellStyles({ column: "amount" })}
						>
							Amount
						</TableHead>
					</TableRow>
				</TableHeader>
			)}
			<TableBody>{children}</TableBody>
		</Table>
	);
}
