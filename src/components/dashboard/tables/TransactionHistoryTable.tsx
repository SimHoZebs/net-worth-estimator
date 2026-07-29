import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { createTableColumn, DataTable } from "@/components/ui/data-table";
import { TableSearch } from "@/components/ui/table-search";
import { formatRoute } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { PostingAmount } from "./PostingAmount";

const PAGE_SIZE = 20;

interface TransactionHistoryTableProps {
	postings: Posting[];
	accounts: Account[];
	disabledPostingSet: Set<string>;
	onToggle: (id: string) => void;
}

const postingColumn = createTableColumn<Posting>();

export function TransactionHistoryTable({
	postings,
	accounts,
	disabledPostingSet,
	onToggle,
}: TransactionHistoryTableProps) {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return postings
			.map((posting, index) => ({ posting, index }))
			.filter(({ posting }) =>
				query
					? [
							posting.id,
							posting.label,
							posting.sourceAccountId ?? "",
							...(posting.destinations ?? []),
						].some((value) => value.toLowerCase().includes(query))
					: true,
			)
			.sort(
				(left, right) =>
					right.posting.startDate.localeCompare(left.posting.startDate) ||
					left.index - right.index,
			)
			.map(({ posting }) => posting);
	}, [postings, search]);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);
	const currentPage = Math.min(page, pageCount - 1);
	const rows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);

	return (
		<div className="space-y-3">
			<TableSearch
				value={search}
				onChange={(value) => {
					setSearch(value);
					setPage(0);
				}}
				placeholder="Search transaction history..."
			/>
			<DataTable<Posting>
				title="Transaction history"
				description="One-time transactions and balance observations, newest first."
				rows={rows}
				rowKey={(posting) => posting.id}
				emptyText="No one-time transactions match this search."
				variant="flat"
				columns={[
					postingColumn({ key: "startDate", label: "Date" }),
					postingColumn({ key: "label", label: "Description" }),
					postingColumn({
						key: "sourceAccountId",
						label: "Route",
						render: (_value, posting) => {
							const sourceLabel = posting.sourceAccountId
								? (accountById.get(posting.sourceAccountId)?.label ??
									posting.sourceAccountId)
								: null;
							const destinations =
								posting.destinations?.map((id) => ({
									label: accountById.get(id)?.label ?? id,
								})) ?? null;
							return formatRoute(sourceLabel, destinations);
						},
					}),
					postingColumn({
						key: "arithmetic",
						label: "Amount",
						render: (value) => <PostingAmount arithmetic={value} />,
					}),
					postingColumn({
						key: "enabled",
						label: "Enabled",
						render: (_value, posting) => {
							return (
								<input
									type="checkbox"
									aria-label={`Enable ${posting.label}`}
									className="h-4 w-4 rounded accent-primary"
									checked={!disabledPostingSet.has(posting.id)}
									onChange={() => onToggle(posting.id)}
								/>
							);
						},
					}),
				]}
			/>
			<div className="flex flex-wrap items-center justify-between gap-3 type-caption">
				<span>
					{filtered.length} transaction{filtered.length === 1 ? "" : "s"} · Page{" "}
					{currentPage + 1} of {pageCount}
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
