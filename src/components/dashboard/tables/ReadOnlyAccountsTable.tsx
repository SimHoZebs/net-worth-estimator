import { Fragment, useMemo, useState } from "react";
import { ColorSwatch } from "@/components/dashboard/charts/ColorSwatch";
import { PostingAmount } from "@/components/dashboard/tables/PostingAmount";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableSearch } from "@/components/ui/table-search";
import { currency, formatFrequency, formatRoute, pct } from "@/lib/format";
import { associatedAccountIds } from "@/lib/posting-categories";
import type { Account, Posting } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

interface ReadOnlyAccountsTableProps {
	accounts: Account[];
	accountRules: Posting[];
	showAdvanced: boolean;
	disabledAccountSet: Set<string>;
	disabledPostingSet: Set<string>;
	onToggleAccount: (id: string) => void;
	onTogglePosting: (id: string) => void;
}

export function ReadOnlyAccountsTable({
	accounts,
	accountRules,
	showAdvanced,
	disabledAccountSet,
	disabledPostingSet,
	onToggleAccount,
	onTogglePosting,
}: ReadOnlyAccountsTableProps) {
	const [search, setSearch] = useState("");
	const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const rulesByAccount = useMemo(() => {
		const grouped = new Map<string, Posting[]>();
		for (const account of accounts) grouped.set(account.id, []);
		for (const rule of accountRules) {
			for (const accountId of associatedAccountIds(rule, accounts)) {
				grouped.get(accountId)?.push(rule);
			}
		}
		return grouped;
	}, [accountRules, accounts]);
	const unassignedRules = useMemo(
		() =>
			accountRules.filter(
				(rule) => associatedAccountIds(rule, accounts).length === 0,
			),
		[accountRules, accounts],
	);
	const query = search.trim().toLowerCase();
	const visibleAccounts = accounts.filter((account) => {
		const rules = rulesByAccount.get(account.id) ?? [];
		return (
			!query ||
			account.label.toLowerCase().includes(query) ||
			account.id.toLowerCase().includes(query) ||
			rules.some(
				(rule) =>
					rule.label.toLowerCase().includes(query) ||
					rule.id.toLowerCase().includes(query),
			)
		);
	});
	const accountById = new Map(accounts.map((account) => [account.id, account]));

	return (
		<div className="space-y-4">
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search accounts and account rules..."
			/>
			<div>
				<div className="type-title">Accounts</div>
				<div className="type-caption">
					Tracked balances and the future rules associated with each account.
				</div>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Account</TableHead>
						{showAdvanced ? <TableHead>ID</TableHead> : null}
						<TableHead>Min</TableHead>
						<TableHead>Max</TableHead>
						<TableHead>Color</TableHead>
						<TableHead>Enabled</TableHead>
						<TableHead>Account rules</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{visibleAccounts.map((account) => {
						const rules = rulesByAccount.get(account.id) ?? [];
						const isExpanded = expandedIds.has(account.id);
						const regionId = `account-rules-${account.id}`;
						return (
							<Fragment key={account.id}>
								<TableRow>
									<TableCell className="type-value">{account.label}</TableCell>
									{showAdvanced ? (
										<TableCell className="type-code">{account.id}</TableCell>
									) : null}
									<TableCell>
										{account.minBalance === NO_FLOOR
											? "-"
											: currency.format(account.minBalance)}
									</TableCell>
									<TableCell>
										{account.maxBalance === NO_CEILING
											? "-"
											: currency.format(account.maxBalance)}
									</TableCell>
									<TableCell>
										<ColorSwatch color={account.color} />
									</TableCell>
									<TableCell>
										<input
											type="checkbox"
											aria-label={`Enable ${account.label}`}
											className="h-4 w-4 rounded accent-primary"
											checked={!disabledAccountSet.has(account.id)}
											onChange={() => onToggleAccount(account.id)}
										/>
									</TableCell>
									<TableCell>
										<button
											type="button"
											aria-expanded={isExpanded}
											aria-controls={regionId}
											disabled={rules.length === 0}
											onClick={() =>
												setExpandedIds((current) => {
													const next = new Set(current);
													if (next.has(account.id)) next.delete(account.id);
													else next.add(account.id);
													return next;
												})
											}
											className="rounded-lg border border-border px-2.5 py-1 type-caption transition hover:border-ring disabled:cursor-default disabled:opacity-60"
										>
											{rules.length} rule{rules.length === 1 ? "" : "s"}
										</button>
									</TableCell>
								</TableRow>
								{isExpanded ? (
									<TableRow id={regionId}>
										<TableCell
											colSpan={showAdvanced ? 7 : 6}
											className="bg-surface/55 p-4"
										>
											<AccountRulesTable
												accountLabel={account.label}
												rules={rules}
												accountById={accountById}
												showAdvanced={showAdvanced}
												disabledPostingSet={disabledPostingSet}
												onToggle={onTogglePosting}
											/>
										</TableCell>
									</TableRow>
								) : null}
							</Fragment>
						);
					})}
				</TableBody>
			</Table>
			{unassignedRules.length > 0 ? (
				<section
					aria-labelledby="unassigned-account-rules"
					className="rounded-2xl border border-border/80 bg-surface/55 p-4"
				>
					<h3 id="unassigned-account-rules" className="type-title text-base">
						Unassigned account rules
					</h3>
					<p className="mb-3 type-caption">
						Future rules that do not directly identify an account.
					</p>
					<AccountRulesTable
						accountLabel="Unassigned account rules"
						rules={unassignedRules}
						accountById={accountById}
						showAdvanced={showAdvanced}
						disabledPostingSet={disabledPostingSet}
						onToggle={onTogglePosting}
					/>
				</section>
			) : null}
		</div>
	);
}

function AccountRulesTable({
	accountLabel,
	rules,
	accountById,
	showAdvanced,
	disabledPostingSet,
	onToggle,
}: {
	accountLabel: string;
	rules: Posting[];
	accountById: ReadonlyMap<string, Account>;
	showAdvanced: boolean;
	disabledPostingSet: Set<string>;
	onToggle: (id: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Rule</TableHead>
					{showAdvanced ? <TableHead>ID</TableHead> : null}
					<TableHead>Route</TableHead>
					<TableHead>Amount calculation</TableHead>
					<TableHead>Schedule</TableHead>
					<TableHead>Rate assumptions</TableHead>
					<TableHead>Enabled</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rules.map((rule) => {
					const sourceLabel = rule.sourceAccountId
						? (accountById.get(rule.sourceAccountId)?.label ??
							rule.sourceAccountId)
						: null;
					const destinations =
						rule.destinations?.map((id) => ({
							label: accountById.get(id)?.label ?? id,
						})) ?? null;
					const assumptions =
						[
							rule.annualRate ? `${pct.format(rule.annualRate)} rate` : null,
							rule.annualGrowthRate
								? `${pct.format(rule.annualGrowthRate)} growth`
								: null,
							rule.volatility
								? `${pct.format(rule.volatility)} volatility`
								: null,
						]
							.filter(Boolean)
							.join(" · ") || "-";
					return (
						<TableRow key={rule.id}>
							<TableCell className="type-value">{rule.label}</TableCell>
							{showAdvanced ? (
								<TableCell className="type-code">{rule.id}</TableCell>
							) : null}
							<TableCell>{formatRoute(sourceLabel, destinations)}</TableCell>
							<TableCell>
								<PostingAmount arithmetic={rule.arithmetic} />
							</TableCell>
							<TableCell>
								{formatFrequency(rule.frequency)} · {rule.startDate}
								{rule.endDate ? ` to ${rule.endDate}` : ""}
							</TableCell>
							<TableCell>{assumptions}</TableCell>
							<TableCell>
								<input
									type="checkbox"
									aria-label={`Enable ${rule.label} for ${accountLabel}`}
									className="h-4 w-4 rounded accent-primary"
									checked={!disabledPostingSet.has(rule.id)}
									onChange={() => onToggle(rule.id)}
								/>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
