import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	Table as ShadcnTable,
	TableBody as ShadcnTableBody,
	TableCaption as ShadcnTableCaption,
	TableHead as ShadcnTableHead,
	TableHeader as ShadcnTableHeader,
	TableRow as ShadcnTableRow,
} from "@/components/ui/table.tsx";

/**
 * Shared table shell on the preset Table composition. The shadcn `Table`
 * owns the single keyboard-accessible scroll region: the caption names it
 * via the container's region label, so callers must not nest another
 * scroll container inside or around it. Headers render from a plain column
 * list (no TanStack header model); body rows stay caller-owned JSX.
 * Density, dividers, and hover are preset-owned.
 */

export interface DataTableColumn {
	label: ReactNode;
	className?: string;
	/** Render the label for screen readers only (e.g. an Actions column). */
	srOnly?: boolean;
}

/**
 * Shared table shell: caption plus an opt-in header row. Headers stay hidden
 * unless `showHeaders` is set so repeated tables read as structure (position,
 * icons, alignment) instead of repeated labels.
 */
export function DataTable({
	className = "",
	caption,
	columns = [],
	showHeaders = false,
	scrollId,
	colgroup,
	children,
	...props
}: Omit<ComponentProps<"table">, "children"> & {
	caption: string;
	columns?: DataTableColumn[];
	showHeaders?: boolean;
	scrollId?: string;
	colgroup?: ReactNode;
	children: ReactNode;
}) {
	const headers = showHeaders && columns.length > 0 ? columns : [];
	return (
		<ShadcnTable
			containerProps={{ id: scrollId, role: "region", "aria-label": caption }}
			{...props}
			className={className}
		>
			<ShadcnTableCaption>{caption}</ShadcnTableCaption>
			{colgroup}
			{headers.length > 0 && (
				<ShadcnTableHeader>
					<ShadcnTableRow>
						{headers.map((column, index) => (
							<ShadcnTableHead
								key={`column-${index}`}
								scope="col"
								className={column.className}
							>
								{column.srOnly ? (
									<span className="sr-only">{column.label}</span>
								) : (
									column.label
								)}
							</ShadcnTableHead>
						))}
					</ShadcnTableRow>
				</ShadcnTableHeader>
			)}
			<ShadcnTableBody>{children}</ShadcnTableBody>
		</ShadcnTable>
	);
}

/** Shared pager for server-driven tables. Pages stay zero-based. */
export function TablePagination({
	page,
	pageCount,
	total,
	pageSize,
	itemNoun = "transactions",
	onPage,
	topBorder = false,
	className,
}: {
	page: number;
	pageCount: number;
	total: number;
	pageSize: number;
	itemNoun?: string;
	onPage: (next: number) => void;
	topBorder?: boolean;
	className?: string;
}) {
	const safePageCount = Math.max(1, pageCount);
	const currentPage = Math.min(Math.max(page, 0), safePageCount - 1);
	const canPrevious = currentPage > 0;
	const canNext = currentPage < safePageCount - 1;
	return (
		<div
			className={cn(
				"flex items-center justify-between gap-4 border-b border-border py-4 max-sm:gap-2",
				topBorder ? "border-t" : "",
				className,
			)}
		>
			<span className="text-xs text-muted-foreground" role="status">
				{total === 0
					? `No ${itemNoun}`
					: `Showing ${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, total)} of ${total} ${itemNoun}`}
			</span>
			<div className="flex items-center gap-3 max-sm:gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={!canPrevious}
					onClick={() => onPage(currentPage - 1)}
					aria-label="Previous transaction page"
				>
					<ChevronLeft aria-hidden="true" />
				</Button>
				<span className="text-xs text-muted-foreground tabular-nums">
					{currentPage + 1} / {safePageCount}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={!canNext}
					onClick={() => onPage(currentPage + 1)}
					aria-label="Next transaction page"
				>
					<ChevronRight aria-hidden="true" />
				</Button>
			</div>
		</div>
	);
}
