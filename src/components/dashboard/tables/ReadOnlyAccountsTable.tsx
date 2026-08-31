import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TableSearch } from "@/components/ui/table-search";
import { currency, formatDate } from "@/lib/format";
import { associatedAccountIds } from "@/lib/posting-categories";
import type {
	Account,
	Posting,
	ProjectionAccountSummary,
} from "@/lib/projection";
import {
	AccountPositionGroup,
	type AccountPositionRow,
} from "./AccountPositionGroup";
import { AccountRules } from "./AccountRules";

interface ReadOnlyAccountsTableProps {
	accounts: Account[];
	accountRules: Posting[];
	accountSummaries: ProjectionAccountSummary[] | null;
	currentNetWorth: number | null;
	projectionStartDate: string;
	balancesAreStale: boolean;
	showAdvanced: boolean;
}

export function ReadOnlyAccountsTable({
	accounts,
	accountRules,
	accountSummaries,
	currentNetWorth,
	projectionStartDate,
	balancesAreStale,
	showAdvanced,
}: ReadOnlyAccountsTableProps) {
	const [search, setSearch] = useState("");
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const duplicateAccountIds = useMemo(
		() => duplicateIds(accounts.map((account) => account.id)),
		[accounts],
	);
	const duplicateSummaryIds = useMemo(
		() =>
			duplicateIds(accountSummaries?.map((summary) => summary.accountId) ?? []),
		[accountSummaries],
	);
	const ambiguousIds = new Set([
		...duplicateAccountIds,
		...duplicateSummaryIds,
	]);
	const balancesAvailable = accountSummaries !== null && !balancesAreStale;
	const summariesById = new Map(
		(accountSummaries ?? []).map((summary) => [summary.accountId, summary]),
	);
	const { rulesByAccount, unassignedRules } = useMemo(() => {
		const grouped = new Map<string, Posting[]>();
		const unassigned: Posting[] = [];
		const accountIds = new Set(accounts.map((account) => account.id));
		for (const account of accounts) grouped.set(account.id, []);
		for (const rule of accountRules) {
			const associations = associatedAccountIds(rule, accountIds);
			if (associations.length === 0) unassigned.push(rule);
			for (const accountId of associations) {
				grouped.get(accountId)?.push(rule);
			}
		}
		return { rulesByAccount: grouped, unassignedRules: unassigned };
	}, [accountRules, accounts]);
	const rows: AccountPositionRow[] = accounts.map((account) => {
		const summary = summariesById.get(account.id);
		return {
			account,
			balance:
				balancesAvailable && !ambiguousIds.has(account.id) && summary?.enabled
					? summary.startingBalance
					: null,
			rules: rulesByAccount.get(account.id) ?? [],
		};
	});
	const assetRows = rows.filter(
		(row) => row.balance !== null && row.balance >= 0,
	);
	const liabilityRows = rows.filter(
		(row) => row.balance !== null && row.balance < 0,
	);
	const unavailableRows = rows.filter((row) => row.balance === null);
	const assetsTotal = assetRows.reduce(
		(sum, row) => sum + (row.balance ?? 0),
		0,
	);
	const liabilitiesTotal = liabilityRows.reduce(
		(sum, row) => sum + (row.balance ?? 0),
		0,
	);
	const query = search.trim().toLowerCase();
	const matchesSearch = (row: AccountPositionRow) =>
		!query ||
		row.account.label.toLowerCase().includes(query) ||
		row.account.id.toLowerCase().includes(query) ||
		row.rules.some(
			(rule) =>
				rule.label.toLowerCase().includes(query) ||
				rule.id.toLowerCase().includes(query),
		);
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const toggleExpanded = (id: string) =>
		setExpandedIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	return (
		<div className="space-y-5">
			<section className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-gradient-to-br from-card via-card to-surface/70">
				<div className="border-b border-border/70 p-5 md:flex md:items-end md:justify-between md:gap-6">
					<div>
						<div className="type-eyebrow text-primary">Current position</div>
						<h2 className="mt-1 type-title text-xl">Your accounts</h2>
						<p className="mt-1 max-w-2xl type-muted">
							Balances after recorded activity through{" "}
							{formatDate(projectionStartDate)}.
						</p>
					</div>
					<div className="mt-3 shrink-0 type-caption md:mt-0">
						As of{" "}
						<span className="type-value">
							{formatDate(projectionStartDate)}
						</span>
					</div>
				</div>
				<div className="grid divide-y divide-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
					<PositionMetric
						label="Net worth"
						value={balancesAvailable ? currentNetWorth : null}
					/>
					<PositionMetric
						label="Assets"
						value={balancesAvailable ? assetsTotal : null}
					/>
					<PositionMetric
						label="Liabilities"
						value={balancesAvailable ? liabilitiesTotal : null}
					/>
				</div>
			</section>

			{balancesAreStale ? (
				<Alert>
					<AlertTitle>Updating balances</AlertTitle>
					<AlertDescription>
						The account list is current. Balances will return when the latest
						projection finishes.
					</AlertDescription>
				</Alert>
			) : accountSummaries === null ? (
				<Alert>
					<AlertTitle>Balances unavailable</AlertTitle>
					<AlertDescription>
						Accounts remain available to inspect, but no completed projection
						can provide balances yet.
					</AlertDescription>
				</Alert>
			) : null}
			{ambiguousIds.size > 0 ? (
				<Alert variant="destructive">
					<AlertTitle>
						Duplicate account IDs prevent balance matching
					</AlertTitle>
					<AlertDescription>
						Resolve these IDs before relying on balances:{" "}
						{Array.from(ambiguousIds).join(", ")}.
					</AlertDescription>
				</Alert>
			) : null}

			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search accounts and rules..."
			/>
			<div className="grid gap-5 xl:grid-cols-2">
				<AccountPositionGroup
					title="Assets"
					description="Cash, investments, and other positive balances."
					rows={assetRows.filter(matchesSearch)}
					emptyText="No assets match this search."
					{...{ showAdvanced, expandedIds, toggleExpanded, accountById }}
				/>
				<AccountPositionGroup
					title="Liabilities"
					description="Loans and other balances that reduce net worth."
					rows={liabilityRows.filter(matchesSearch)}
					emptyText="No liabilities match this search."
					{...{ showAdvanced, expandedIds, toggleExpanded, accountById }}
				/>
			</div>
			{unavailableRows.some(matchesSearch) ? (
				<AccountPositionGroup
					title="Balances unavailable"
					description="These accounts are current; their balances are waiting for a completed projection."
					rows={unavailableRows.filter(matchesSearch)}
					emptyText=""
					{...{ showAdvanced, expandedIds, toggleExpanded, accountById }}
				/>
			) : null}
			{unassignedRules.length > 0 ? (
				<section className="rounded-2xl border border-border/80 bg-surface/55 p-4">
					<h3 className="type-title text-base">Other rules</h3>
					<p className="mb-3 type-caption">
						Rules that are not tied to a specific account.
					</p>
					<AccountRules
						rules={unassignedRules}
						accountById={accountById}
						showAdvanced={showAdvanced}
					/>
				</section>
			) : null}
		</div>
	);
}

function PositionMetric({
	label,
	value,
}: {
	label: string;
	value: number | null;
}) {
	return (
		<div className="px-5 py-4">
			<div className="type-label">{label}</div>
			<div className="mt-1 type-metric text-foreground">
				{value === null ? "-" : currency.format(value)}
			</div>
		</div>
	);
}

function duplicateIds(ids: string[]) {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) duplicates.add(id);
		seen.add(id);
	}
	return duplicates;
}
