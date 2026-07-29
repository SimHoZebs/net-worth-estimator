import { Fragment } from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { currency } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import { AccountIdentity } from "./AccountIdentity";
import { AccountRules } from "./AccountRules";

export interface AccountPositionRow {
	account: Account;
	balance: number | null;
	rules: Posting[];
}

interface AccountPositionGroupProps {
	title: string;
	description: string;
	rows: AccountPositionRow[];
	emptyText: string;
	showAdvanced: boolean;
	expandedIds: ReadonlySet<string>;
	toggleExpanded: (id: string) => void;
	accountById: ReadonlyMap<string, Account>;
}

export function AccountPositionGroup({
	title,
	description,
	rows,
	emptyText,
	showAdvanced,
	expandedIds,
	toggleExpanded,
	accountById,
}: AccountPositionGroupProps) {
	return (
		<section className="overflow-hidden rounded-2xl border border-border/80 bg-card/75">
			<div className="border-b border-border/70 px-4 py-3">
				<h3 className="type-title text-base">{title}</h3>
				<p className="type-caption">{description}</p>
			</div>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Account</TableHead>
						<TableHead className="text-right">Balance</TableHead>
						<TableHead>Rules</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.length === 0 ? (
						<TableRow>
							<TableCell colSpan={3} className="py-6 text-center type-muted">
								{emptyText}
							</TableCell>
						</TableRow>
					) : (
						rows.map((row, index) => {
							const isExpanded = expandedIds.has(row.account.id);
							const regionId = `account-details-${row.account.id}-${index}`;
							return (
								<Fragment key={`${row.account.id}-${index}`}>
									<TableRow>
										<TableCell className="type-value">
											<AccountIdentity account={row.account} />
										</TableCell>
										<TableCell className="text-right type-value tabular-nums">
											{row.balance === null
												? "-"
												: currency.format(row.balance)}
										</TableCell>
										<TableCell>
											<button
												type="button"
												aria-label={`${row.rules.length} rule${row.rules.length === 1 ? "" : "s"} for ${row.account.label}`}
												aria-expanded={isExpanded}
												aria-controls={regionId}
												onClick={() => toggleExpanded(row.account.id)}
												className="rounded-lg border border-border px-2.5 py-1 type-caption transition hover:border-ring"
											>
												{row.rules.length} rule
												{row.rules.length === 1 ? "" : "s"}
											</button>
										</TableCell>
									</TableRow>
									{isExpanded ? (
										<TableRow id={regionId}>
											<TableCell
												colSpan={3}
												className="max-w-0 whitespace-normal bg-surface/55 p-4"
											>
												{showAdvanced ? (
													<AccountTechnicalDetails account={row.account} />
												) : null}
												{row.rules.length > 0 ? (
													<AccountRules
														rules={row.rules}
														accountById={accountById}
														showAdvanced={showAdvanced}
													/>
												) : (
													<p className="type-caption">
														No rules are associated with this account.
													</p>
												)}
											</TableCell>
										</TableRow>
									) : null}
								</Fragment>
							);
						})
					)}
				</TableBody>
			</Table>
		</section>
	);
}

function AccountTechnicalDetails({ account }: { account: Account }) {
	return (
		<div className="mb-4 grid gap-2 rounded-xl border border-border/70 bg-card/70 p-3 sm:grid-cols-3">
			<div>
				<span className="type-label">ID</span>
				<div className="type-code break-all">{account.id}</div>
			</div>
			<div>
				<span className="type-label">Minimum</span>
				<div className="type-body">
					{account.minBalance === NO_FLOOR
						? "No floor"
						: currency.format(account.minBalance)}
				</div>
			</div>
			<div>
				<span className="type-label">Maximum</span>
				<div className="type-body">
					{account.maxBalance === NO_CEILING
						? "No ceiling"
						: currency.format(account.maxBalance)}
				</div>
			</div>
		</div>
	);
}
