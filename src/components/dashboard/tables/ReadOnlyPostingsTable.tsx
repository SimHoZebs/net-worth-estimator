import { useMemo, useState } from "react";
import { Collapsible } from "@/components/ui/collapsible-section";
import { TableSearch } from "@/components/ui/table-search";
import { currency, formatDate, formatFrequency, pct } from "@/lib/format";
import { isPastScheduledPosting } from "@/lib/posting-categories";
import type { Account, Posting } from "@/lib/projection";
import {
	TransactionListRow,
	transactionMatchesSearch,
} from "./TransactionPresentation";

interface ReadOnlyPostingsTableProps {
	postings: Posting[];
	accounts: Account[];
	projectionStartDate: string;
	showAdvanced: boolean;
}

export function ReadOnlyPostingsTable({
	postings,
	accounts,
	projectionStartDate,
	showAdvanced,
}: ReadOnlyPostingsTableProps) {
	const [search, setSearch] = useState("");
	const accountById = useMemo(
		() => new Map(accounts.map((account) => [account.id, account])),
		[accounts],
	);
	const visiblePostings = useMemo(() => {
		const query = search.trim().toLowerCase();
		return postings.filter((posting) =>
			transactionMatchesSearch(posting, accountById, query),
		);
	}, [postings, search, accountById]);
	const currentPostings = visiblePostings.filter(
		(posting) => !isPastScheduledPosting(posting, projectionStartDate),
	);
	const pastPostings = visiblePostings.filter((posting) =>
		isPastScheduledPosting(posting, projectionStartDate),
	);

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
			{currentPostings.length > 0 ? (
				<PostingRows
					postings={currentPostings}
					accountById={accountById}
					showAdvanced={showAdvanced}
				/>
			) : (
				<div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center type-muted">
					No current scheduled transactions match this search.
				</div>
			)}
			{pastPostings.length > 0 ? (
				<Collapsible className="!rounded-2xl !border-border/70 !bg-surface/55 !p-0 !shadow-none !backdrop-blur-none">
					<Collapsible.Trigger className="flex items-center justify-between gap-3 px-4 py-3 type-label text-muted-foreground hover:text-foreground">
						<span>
							Past scheduled transactions · {pastPostings.length} transaction
							{pastPostings.length === 1 ? "" : "s"}
						</span>
						<Collapsible.Chevron />
					</Collapsible.Trigger>
					<Collapsible.Content className="!mt-0 border-t border-border/70">
						<PostingRows
							postings={pastPostings}
							accountById={accountById}
							showAdvanced={showAdvanced}
							borderless
						/>
					</Collapsible.Content>
				</Collapsible>
			) : null}
			<div className="type-caption">
				{currentPostings.length} current transaction
				{currentPostings.length === 1 ? "" : "s"}
			</div>
		</div>
	);
}

function PostingRows({
	postings,
	accountById,
	showAdvanced,
	borderless = false,
}: {
	postings: Posting[];
	accountById: ReadonlyMap<string, Account>;
	showAdvanced: boolean;
	borderless?: boolean;
}) {
	return (
		<div
			className={`divide-y divide-border/60 bg-card/70 ${borderless ? "rounded-b-2xl" : "rounded-2xl border border-border/80"}`}
		>
			{postings.map((posting) => (
				<TransactionListRow
					key={posting.id}
					posting={posting}
					accountById={accountById}
					showCalculationDetails
					meta={<Schedule posting={posting} />}
					technical={
						showAdvanced ? <TechnicalDetails posting={posting} /> : null
					}
				/>
			))}
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
		<div>
			<div>
				{posting.id} · {assumptions.join(" · ")}
			</div>
			<details className="mt-1">
				<summary className="cursor-pointer select-none type-caption">
					Raw amount configuration
				</summary>
				<pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/70 p-2 type-code">
					{JSON.stringify(posting.amount, null, 2)}
				</pre>
			</details>
		</div>
	);
}
