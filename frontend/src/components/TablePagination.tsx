import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";

/** Shared pager for server-driven tables. Pages stay zero-based. Callers own
 * filtering, page reset on filter change, and the table scroll region; the
 * pager leaves focus on the activated button and performs no scrolling. */
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
