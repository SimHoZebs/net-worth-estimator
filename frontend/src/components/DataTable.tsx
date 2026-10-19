import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "./ui.tsx";

export interface DataTableColumn {
	label: ReactNode;
	className?: string;
	/** Render the label for screen readers only (e.g. an Actions column). */
	srOnly?: boolean;
}

/**
 * Shared table shell: scroll container, caption, and an opt-in header row.
 * Headers stay hidden unless `showHeaders` is set so repeated tables read
 * as structure (position, icons, alignment) instead of repeated labels.
 */
export function DataTable({
	className = "",
	caption,
	columns = [],
	showHeaders = false,
	scrollId,
	children,
}: {
	className?: string;
	caption: string;
	columns?: DataTableColumn[];
	showHeaders?: boolean;
	scrollId?: string;
	children: ReactNode;
}) {
	return (
		<div className="table-scroll" {...(scrollId ? { id: scrollId } : {})}>
			<table className={className}>
				<caption className="sr-only">{caption}</caption>
				{showHeaders && columns.length > 0 && (
					<thead>
						<tr>
							{columns.map((column, index) => (
								<th
									key={index}
									scope="col"
									{...(column.className ? { className: column.className } : {})}
								>
									{column.srOnly ? (
										<span className="sr-only">{column.label}</span>
									) : (
										column.label
									)}
								</th>
							))}
						</tr>
					</thead>
				)}
				<tbody>{children}</tbody>
			</table>
		</div>
	);
}

/** Shared pager for the transaction-style tables. Pages stay zero-based. */
export function TablePagination({
	page,
	pageCount,
	total,
	pageSize,
	itemNoun = "transactions",
	onPage,
}: {
	page: number;
	pageCount: number;
	total: number;
	pageSize: number;
	itemNoun?: string;
	onPage: (next: number) => void;
}) {
	const currentPage = Math.min(page, pageCount - 1);
	return (
		<div className="transaction-pagination">
			<span role="status">
				Showing {currentPage * pageSize + 1}–
				{Math.min((currentPage + 1) * pageSize, total)} of {total} {itemNoun}
			</span>
			<div>
				<IconButton
					icon={ChevronLeft}
					label="Previous transaction page"
					disabled={currentPage === 0}
					onClick={() => onPage(currentPage - 1)}
				/>
				<span>
					{currentPage + 1} / {pageCount}
				</span>
				<IconButton
					icon={ChevronRight}
					label="Next transaction page"
					disabled={currentPage === pageCount - 1}
					onClick={() => onPage(currentPage + 1)}
				/>
			</div>
		</div>
	);
}
