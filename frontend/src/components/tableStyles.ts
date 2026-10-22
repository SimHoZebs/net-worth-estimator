import { cva } from "class-variance-authority";

export const tableStyles = cva("w-full border-collapse text-left text-sm");
export const tableScrollStyles = cva("relative max-w-full overflow-x-auto");
export const tableHeadStyles = cva(
	"border-b border-line bg-surface-2 text-muted",
);
export const tableRowStyles = cva("border-b border-line last:border-b-0");
export const tableHeaderStyles = cva(
	"border-0 px-5 py-4 font-medium whitespace-nowrap",
	{
		variants: {
			scope: {
				col: "text-xs",
				row: "text-sm",
				colgroup: "text-xs",
				rowgroup: "text-sm",
			},
		},
		defaultVariants: { scope: "col" },
	},
);
export const tableCellStyles = cva("border-0 px-5 py-4 whitespace-nowrap");
export const tablePaginationStyles = cva(
	"flex items-center justify-between gap-4 border-b border-line py-4 [@media(max-width:600px)]:gap-2",
	{
		variants: { topBorder: { true: "border-t", false: "" } },
		defaultVariants: { topBorder: false },
	},
);
