import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { TableSearch } from "@/components/ui/table-search";
import { formatDate } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import {
	TransactionListRow,
	transactionMatchesSearch,
} from "./TransactionPresentation";

const DATE_GROUPS_PER_PAGE = 10;

interface TransactionHistoryTableProps {
	postings: Posting[];
	accounts: Account[];
}

export function TransactionHistoryTable({
	postings,
	accounts,
}: TransactionHistoryTableProps) {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const groups = useMemo(() => {
		const query = search.trim().toLowerCase();
		const byDate = new Map<string, Posting[]>();
		for (const posting of postings) {
			if (!transactionMatchesSearch(posting, accountById, query)) {
				continue;
			}
			const dateGroup = byDate.get(posting.startDate) ?? [];
			dateGroup.push(posting);
			byDate.set(posting.startDate, dateGroup);
		}
		return Array.from(byDate, ([date, transactions]) => ({
			date,
			transactions,
		})).sort((left, right) => right.date.localeCompare(left.date));
	}, [postings, search, accountById]);
	const pageCount = Math.max(
		1,
		Math.ceil(groups.length / DATE_GROUPS_PER_PAGE),
	);
	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);
	const currentPage = Math.min(page, pageCount - 1);
	const visibleGroups = groups.slice(
		currentPage * DATE_GROUPS_PER_PAGE,
		(currentPage + 1) * DATE_GROUPS_PER_PAGE,
	);
	const transactionCount = groups.reduce(
		(total, group) => total + group.transactions.length,
		0,
	);

	return (
		<div className="space-y-4">
			<div>
				<h2 className="type-title">Transaction history</h2>
				<p className="type-caption">
					Recorded one-time activity, newest first.
				</p>
			</div>
			<TableSearch
				value={search}
				onChange={(value) => {
					setSearch(value);
					setPage(0);
				}}
				placeholder="Search transaction history..."
			/>
			<div className="space-y-6">
				{visibleGroups.length > 0 ? (
					visibleGroups.map((group) => (
						<section key={group.date} aria-labelledby={`date-${group.date}`}>
							<div className="mb-2 flex items-baseline gap-3 border-b border-border/70 pb-2">
								<h3 id={`date-${group.date}`} className="type-title text-base">
									{formatDate(group.date)}
								</h3>
								<span className="type-caption">
									{group.transactions.length} transaction
									{group.transactions.length === 1 ? "" : "s"}
								</span>
							</div>
							<div className="divide-y divide-border/60 rounded-2xl border border-border/80 bg-card/70">
								{group.transactions.map((posting) => (
									<TransactionListRow
										key={posting.id}
										posting={posting}
										accountById={accountById}
									/>
								))}
							</div>
						</section>
					))
				) : (
					<div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
						No transactions match this search.
					</div>
				)}
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 type-caption">
				<span>
					{transactionCount} transaction{transactionCount === 1 ? "" : "s"} ·
					Page {currentPage + 1} of {pageCount}
				</span>
				<nav className="flex gap-2" aria-label="Transaction history pagination">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={currentPage === 0}
						onClick={() => setPage(currentPage - 1)}
					>
						Previous
					</Button>
					<Button
						type="button"
						size="sm"
						variant="ghost"
						disabled={currentPage >= pageCount - 1}
						onClick={() => setPage(currentPage + 1)}
					>
						Next
					</Button>
				</nav>
			</div>
		</div>
	);
}
