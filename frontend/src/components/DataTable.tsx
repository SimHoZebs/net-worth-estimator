import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { IconButton } from "./Button.tsx";
import {
	tableCellStyles,
	tableHeaderStyles,
	tableHeadStyles,
	tablePaginationStyles,
	tableRowStyles,
	tableScrollStyles,
	tableStyles,
} from "./tableStyles.ts";

export function Table({ className, ...props }: ComponentProps<"table">) {
	return <table {...props} className={mergeStyles(tableStyles(), className)} />;
}

export function TableHead({ className, ...props }: ComponentProps<"thead">) {
	return (
		<thead {...props} className={mergeStyles(tableHeadStyles(), className)} />
	);
}

export function TableBody(props: ComponentProps<"tbody">) {
	return <tbody {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return <tr {...props} className={mergeStyles(tableRowStyles(), className)} />;
}

export function TableHeader({
	className,
	scope = "col",
	...props
}: ComponentProps<"th">) {
	return (
		<th
			{...props}
			scope={scope}
			className={mergeStyles(
				tableHeaderStyles({
					scope: scope === "row" || scope === "rowgroup" ? "row" : "col",
				}),
				className,
			)}
		/>
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return (
		<td {...props} className={mergeStyles(tableCellStyles(), className)} />
	);
}

/** Name the region when keyboard scrolling needs an accessible landmark. */
export function TableScroll({ className, ...props }: ComponentProps<"div">) {
	return (
		<div {...props} className={mergeStyles(tableScrollStyles(), className)} />
	);
}

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
	...props
}: Omit<ComponentProps<"table">, "children"> & {
	caption: string;
	columns?: DataTableColumn[];
	showHeaders?: boolean;
	scrollId?: string;
	children: ReactNode;
}) {
	return (
		<TableScroll id={scrollId} tabIndex={0} role="region" aria-label={caption}>
			<Table {...props} className={className}>
				<caption className="sr-only">{caption}</caption>
				{showHeaders && columns.length > 0 && (
					<TableHead>
						<TableRow>
							{columns.map((column, index) => (
								<TableHeader
									key={index}
									scope="col"
									{...(column.className ? { className: column.className } : {})}
								>
									{column.srOnly ? (
										<span className="sr-only">{column.label}</span>
									) : (
										column.label
									)}
								</TableHeader>
							))}
						</TableRow>
					</TableHead>
				)}
				<TableBody>{children}</TableBody>
			</Table>
		</TableScroll>
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
	const currentPage = Math.min(page, pageCount - 1);
	return (
		<div
			className={mergeStyles(tablePaginationStyles({ topBorder }), className)}
		>
			<span className="text-xs text-muted" role="status">
				Showing {currentPage * pageSize + 1}–
				{Math.min((currentPage + 1) * pageSize, total)} of {total} {itemNoun}
			</span>
			<div className="flex items-center gap-3 max-sm:gap-1">
				<IconButton
					icon={ChevronLeft}
					label="Previous transaction page"
					disabled={currentPage === 0}
					onClick={() => onPage(currentPage - 1)}
				/>
				<span className="text-xs text-muted tabular-nums">
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
