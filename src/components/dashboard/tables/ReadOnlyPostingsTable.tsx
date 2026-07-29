import { useMemo, useState } from "react";
import { TableSearch } from "@/components/ui/table-search";
import { currency, formatDate, formatFrequency, pct } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import {
	TransactionListRow,
	transactionMatchesSearch,
} from "./TransactionPresentation";

interface ReadOnlyPostingsTableProps {
	postings: Posting[];
	accounts: Account[];
	showAdvanced: boolean;
}

export function ReadOnlyPostingsTable({
	postings,
	accounts,
	showAdvanced,
}: ReadOnlyPostingsTableProps) {
	const [search, setSearch] = useState("");
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const visiblePostings = useMemo(() => {
		const query = search.trim().toLowerCase();
		return postings.filter((posting) =>
			transactionMatchesSearch(posting, accountById, query),
		);
	}, [postings, search, accountById]);

	return (
		<div className="space-y-4">
			<div>
				<h2 className="type-title">Scheduled transactions</h2>
				<p className="type-caption">
					Recurring money in, money out, and transfers.
				</p>
			</div>
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search scheduled transactions..."
			/>
			{visiblePostings.length > 0 ? (
				<div className="divide-y divide-border/60 rounded-2xl border border-border/80 bg-card/70">
					{visiblePostings.map((posting) => (
						<TransactionListRow
							key={posting.id}
							posting={posting}
							accountById={accountById}
							meta={<Schedule posting={posting} />}
							technical={
								showAdvanced ? <TechnicalDetails posting={posting} /> : null
							}
						/>
					))}
				</div>
			) : (
				<div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
					No scheduled transactions match this search.
				</div>
			)}
			<div className="type-caption">
				{visiblePostings.length} transaction
				{visiblePostings.length === 1 ? "" : "s"}
			</div>
		</div>
	);
}

function Schedule({ posting }: { posting: Posting }) {
	return (
		<>
			{formatFrequency(posting.frequency)} from {formatDate(posting.startDate)}
			{posting.endDate ? ` through ${formatDate(posting.endDate)}` : ""}
		</>
	);
}

function TechnicalDetails({ posting }: { posting: Posting }) {
	const assumptions = [
		posting.annualRate ? `${pct.format(posting.annualRate)} rate` : null,
		posting.annualGrowthRate
			? `${pct.format(posting.annualGrowthRate)} growth`
			: null,
		posting.volatility ? `${pct.format(posting.volatility)} volatility` : null,
		posting.annualCap !== null
			? `${currency.format(posting.annualCap)} cap`
			: null,
		`priority ${posting.priority}`,
	].filter(Boolean);
	return (
		<>
			{posting.id} · {assumptions.join(" · ")}
		</>
	);
}
