import { ChevronLeft, ChevronRight } from "lucide-react";
import {
	createPaginatedRowModel,
	flexRender,
	rowPaginationFeature,
	tableFeatures,
	useTable,
	type ColumnDef,
} from "@tanstack/react-table";
import type { ComponentProps, ReactNode } from "react";
import { useMemo } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { IconButton } from "./Button.tsx";
import {
	Table as ShadcnTable,
	TableBody as ShadcnTableBody,
	TableCaption as ShadcnTableCaption,
	TableCell as ShadcnTableCell,
	TableHead as ShadcnTableHead,
	TableHeader as ShadcnTableHeader,
	TableRow as ShadcnTableRow,
} from "./ui/table.tsx";

/**
 * shadcn table shells with the application table tokens layered on top.
 * The shadcn classes stay first so the app tokens (spacing, dividers,
 * muted headers) and then caller overrides win each merge conflict.
 */
const tableBaseClassName = "w-full border-collapse text-left text-sm";
const tableScrollBaseClassName = "relative max-w-full overflow-x-auto";
const tableHeadBaseClassName = "border-b border-line bg-surface-2 text-muted";
const tableRowBaseClassName =
	"border-b border-line last:border-b-0 hover:bg-transparent";
const tableHeaderBaseClassName =
	"h-auto border-0 px-5 py-4 font-medium whitespace-nowrap";
const tableHeaderColumnClassName = "text-xs text-muted";
const tableHeaderRowClassName = "text-sm text-inherit";
const tableCellBaseClassName = "border-0 px-5 py-4 whitespace-nowrap";
const tableCaptionBaseClassName = "sr-only";
const tablePaginationBaseClassName =
	"flex items-center justify-between gap-4 border-b border-line py-4 max-sm:gap-2";

export function Table({ className, ...props }: ComponentProps<"table">) {
	return (
		<ShadcnTable
			{...props}
			className={mergeStyles(tableBaseClassName, className)}
		/>
	);
}

export function TableHead({ className, ...props }: ComponentProps<"thead">) {
	return (
		<ShadcnTableHeader
			{...props}
			className={mergeStyles(tableHeadBaseClassName, className)}
		/>
	);
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
	return <ShadcnTableBody {...props} className={className} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return (
		<ShadcnTableRow
			{...props}
			className={mergeStyles(tableRowBaseClassName, className)}
		/>
	);
}

export function TableHeader({
	className,
	scope = "col",
	...props
}: ComponentProps<"th">) {
	const rowScope = scope === "row" || scope === "rowgroup";
	return (
		<ShadcnTableHead
			{...props}
			scope={scope}
			className={mergeStyles(
				tableHeaderBaseClassName,
				rowScope ? tableHeaderRowClassName : tableHeaderColumnClassName,
				className,
			)}
		/>
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return (
		<ShadcnTableCell
			{...props}
			className={mergeStyles(tableCellBaseClassName, className)}
		/>
	);
}

/** Name the region when keyboard scrolling needs an accessible landmark. */
export function TableScroll({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			{...props}
			className={mergeStyles(tableScrollBaseClassName, className)}
		/>
	);
}

export interface DataTableColumn {
	label: ReactNode;
	className?: string;
	/** Render the label for screen readers only (e.g. an Actions column). */
	srOnly?: boolean;
}

interface DataTableColumnMeta {
	className?: string;
}

/** Core-only TanStack features plus the typed className slot for headers. */
const dataTableFeatures = tableFeatures({
	columnMeta: {} as DataTableColumnMeta,
});
type DataTableFeatures = typeof dataTableFeatures;

/** Row model is header-only: body rows stay caller-owned, so rows are empty. */
type DataTableRowModel = Record<string, never>;

/** Stable empty model: body rows stay caller-owned, TanStack backs headers. */
const emptyTableData: readonly DataTableRowModel[] = [];

/**
 * Shared table shell: scroll container, caption, and an opt-in header row.
 * Headers stay hidden unless `showHeaders` is set so repeated tables read
 * as structure (position, icons, alignment) instead of repeated labels.
 * The header row is rendered from a TanStack header model built from
 * `columns`; body rows remain caller-owned JSX.
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
	const columnDefs = useMemo<ColumnDef<DataTableFeatures, DataTableRowModel>[]>(
		() =>
			columns.map((column, index) => ({
				id: `column-${index}`,
				header: () =>
					column.srOnly ? (
						<span className="sr-only">{column.label}</span>
					) : (
						column.label
					),
				meta: { className: column.className },
			})),
		[columns],
	);
	const table = useTable({
		features: dataTableFeatures,
		columns: columnDefs,
		data: emptyTableData,
	});
	const headerGroups =
		showHeaders && columns.length > 0 ? table.getHeaderGroups() : [];
	return (
		<TableScroll id={scrollId} tabIndex={0} role="region" aria-label={caption}>
			<Table {...props} className={className}>
				<ShadcnTableCaption className={tableCaptionBaseClassName}>
					{caption}
				</ShadcnTableCaption>
				{colgroup}
				{headerGroups.map((headerGroup) => (
					<TableHead key={headerGroup.id}>
						<TableRow>
							{headerGroup.headers.map((header) => (
								<TableHeader
									key={header.id}
									scope="col"
									className={header.column.columnDef.meta?.className}
								>
									{flexRender(
										header.column.columnDef.header,
										header.getContext(),
									)}
								</TableHeader>
							))}
						</TableRow>
					</TableHead>
				))}
				<TableBody>{children}</TableBody>
			</Table>
		</TableScroll>
	);
}

/** TanStack pagination features with a paginated row model slot. */
const paginationFeatures = tableFeatures({
	rowPaginationFeature,
	paginatedRowModel: createPaginatedRowModel(),
});
type PaginationFeatures = typeof paginationFeatures;

/** Stable empty model: page math is external, TanStack derives the pager. */
const emptyPaginationColumns: ColumnDef<
	PaginationFeatures,
	DataTableRowModel
>[] = [];

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
	const table = useTable({
		features: paginationFeatures,
		columns: emptyPaginationColumns,
		data: emptyTableData,
		manualPagination: true,
		pageCount,
		state: { pagination: { pageIndex: currentPage, pageSize } },
		onPaginationChange: (updater) => {
			const next =
				typeof updater === "function"
					? updater({ pageIndex: currentPage, pageSize })
					: updater;
			onPage(Math.min(Math.max(next.pageIndex, 0), pageCount - 1));
		},
	});
	return (
		<div
			className={mergeStyles(
				tablePaginationBaseClassName,
				topBorder ? "border-t" : "",
				className,
			)}
		>
			<span className="text-xs text-muted" role="status">
				Showing {currentPage * pageSize + 1}–
				{Math.min((currentPage + 1) * pageSize, total)} of {total} {itemNoun}
			</span>
			<div className="flex items-center gap-3 max-sm:gap-1">
				<IconButton
					icon={ChevronLeft}
					label="Previous transaction page"
					disabled={!table.getCanPreviousPage()}
					onClick={() => table.previousPage()}
				/>
				<span className="text-xs text-muted tabular-nums">
					{currentPage + 1} / {pageCount}
				</span>
				<IconButton
					icon={ChevronRight}
					label="Next transaction page"
					disabled={!table.getCanNextPage()}
					onClick={() => table.nextPage()}
				/>
			</div>
		</div>
	);
}
