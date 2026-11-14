import {
	ArrowRightLeft,
	ChevronLeft,
	ChevronRight,
	ListFilter,
	Plus,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
	type AccountTransaction,
	type ActivityFilters,
	defaultAccountViewFilters,
	filterTransactions,
} from "../../domain/accountActivity.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import { useTransactionSelection } from "./useTransactionSelection.ts";
import {
	Empty,
	EmptyContent,
	EmptyHeader,
	EmptyMedia,
} from "@/components/ui/empty.tsx";
import { TransactionDetail } from "./TransactionDetail.tsx";
import { TransactionFilters } from "./TransactionFilters.tsx";
import { TransactionRow } from "./TransactionRow.tsx";
import { TransactionTable } from "./TransactionTable.tsx";
import { Button } from "@/components/ui/button.tsx";
import { TransactionAnalysisProvider } from "../analysis/TransactionAnalysis.tsx";
import { useTransferLinks } from "../../state/analyses.ts";
import { transferLinkForEdge } from "../../pages/flows/TransferMatchNote.tsx";
import {
	resolveTransferPeer,
	type TransferPeerSummary,
} from "./TransferLinkSection.tsx";

const PAGE_SIZE = 10;
export function Transactions({
	occurrences,
	rows,
	accounts,
	startDate,
	readOnly,
	showHeaders = false,
	onEdit,
	onSourceChange,
	canRequestForecast = false,
	projected,
}: {
	/** Projected/recorded occurrences for the current view. */
	occurrences: AccountTransaction[];
	/** All saved transaction rows (detail mapping, claim names). */
	rows: Transaction[];
	accounts: Account[];
	startDate: string;
	readOnly: boolean;
	showHeaders?: boolean;
	onEdit: (target: EditorTarget) => void;
	/** Notifies the dialog when the viewer asks for projected activity. */
	onSourceChange?: (source: ActivityFilters["source"]) => void;
	/**
	 * Saved rules can project for this account even with zero recorded
	 * facts. Keeps the source select available so projected activity
	 * stays requestable; truly empty accounts keep the add-only state.
	 */
	canRequestForecast?: boolean;
	/** Forecast state scoped to projected activity only. */
	projected?: {
		loading: boolean;
		error: string | null;
		requested: boolean;
		retry: () => void;
	};
}) {
	const [filters, setFilters] = useState<ActivityFilters>(
		defaultAccountViewFilters,
	);
	const [page, setPage] = useState(0);
	const id = useId();
	const filtered = useMemo(
		() => filterTransactions({ transactions: occurrences, filters, startDate }),
		[occurrences, filters, startDate],
	);
	const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const pageRows = filtered.slice(
		currentPage * PAGE_SIZE,
		(currentPage + 1) * PAGE_SIZE,
	);
	const savedState = useMemo(
		() => new Map(rows.map((transaction) => [transaction.id, transaction])),
		[rows],
	);
	// One cached link query for the list; each row receives its
	// resolved peer instead of querying per row.
	const linksQuery = useTransferLinks();
	const linkedById = useMemo(() => {
		const links = linksQuery.data?.links ?? [];
		const resolved = new Map<string, TransferPeerSummary>();
		for (const row of rows) {
			const peer = resolveTransferPeer({
				transactionId: row.id,
				link: transferLinkForEdge(links, [row.id]),
				transactions: rows,
				accounts,
			});
			if (peer) resolved.set(row.id, peer);
		}
		return resolved;
	}, [linksQuery.data?.links, rows, accounts]);
	const { selected, inspect, close } = useTransactionSelection(
		occurrences,
		savedState,
	);
	const update = (change: Partial<ActivityFilters>) => {
		setFilters((previous) => ({ ...previous, ...change }));
		setPage(0);
		if (change.source !== undefined) onSourceChange?.(change.source);
	};
	const resetFilters = () => update(defaultAccountViewFilters);
	const turnPage = (next: number) => {
		setPage(next);
		document
			.getElementById(`${id}-table`)
			?.scrollIntoView({ block: "nearest" });
	};
	const showsProjected = filters.source !== "historical";
	if (!occurrences.length && !canRequestForecast)
		return (
			<Empty className="px-6 py-12">
				<EmptyHeader>
					<EmptyMedia>
						<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
							<ArrowRightLeft size={28} aria-hidden="true" />
						</span>
					</EmptyMedia>
					{/* Real heading: the preset empty title is a plain div,
					which dropped the heading the account specs assert. */}
					<h3 className="font-heading text-lg font-medium tracking-tight">
						No transactions for this account yet
					</h3>
				</EmptyHeader>
				<EmptyContent>
					<Button
						type="button"
						onClick={() => onEdit({ kind: "transaction", item: null })}
					>
						Add transaction
					</Button>
				</EmptyContent>
			</Empty>
		);
	return (
		<>
			<TransactionFilters
				filters={filters}
				recordedCount={
					occurrences.filter(
						(transaction) => transaction.source === "historical",
					).length
				}
				totalCount={occurrences.length}
				onChange={update}
				action={
					!readOnly && occurrences.length > 0 ? (
						<Button
							type="button"
							variant="default"
							size="sm"
							onClick={() => onEdit({ kind: "transaction", item: null })}
						>
							<Plus size={16} />
							Add transaction
						</Button>
					) : undefined
				}
			/>
			{showsProjected && (
				<div className="h-24 overflow-auto">
					{projected?.loading ? (
						<p role="status">Loading projected activity…</p>
					) : null}
					{projected?.error ? (
						<p role="alert">
							{projected.error}{" "}
							<Button
								type="button"
								variant="link"
								size="sm"
								onClick={projected.retry}
							>
								Retry forecast
							</Button>
						</p>
					) : null}
				</div>
			)}
			{filtered.length ? (
				<>
					<TransactionAnalysisProvider
						transactionIds={pageRows.map(
							(transaction) => transaction.transactionId,
						)}
					>
						<TransactionTable
							caption="Transactions involving this account, separated into recorded facts and projected transactions."
							showHeaders={showHeaders}
							scrollId={`${id}-table`}
						>
							{pageRows.map((transaction) => (
								<TransactionRow
									key={transaction.id}
									transaction={transaction}
									savedTransaction={
										savedState.get(transaction.transactionId) ?? null
									}
									transferPeer={
										linkedById.get(transaction.transactionId) ?? null
									}
									onEdit={() => {
										const savedTransaction = savedState.get(
											transaction.transactionId,
										);
										if (savedTransaction) inspect(transaction);
									}}
								/>
							))}
						</TransactionTable>
					</TransactionAnalysisProvider>
					<div className="flex items-center justify-between gap-4 border-b border-border py-4 max-sm:gap-2">
						<span className="text-xs text-muted-foreground" role="status">
							Showing {currentPage * PAGE_SIZE + 1}–
							{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of{" "}
							{filtered.length} transactions
						</span>
						{/* Real buttons with the long-standing pager names: the
							preset pagination links renamed them and broke the
							transaction-page contract, stalling filter tests. */}
						<div className="flex items-center gap-3 max-sm:gap-1">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Previous transaction page"
								disabled={currentPage === 0}
								onClick={() => turnPage(currentPage - 1)}
							>
								<ChevronLeft size={16} aria-hidden="true" />
							</Button>
							<span className="text-xs text-muted-foreground tabular-nums">
								{currentPage + 1} / {pageCount}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Next transaction page"
								disabled={currentPage >= pageCount - 1}
								onClick={() => turnPage(currentPage + 1)}
							>
								<ChevronRight size={16} aria-hidden="true" />
							</Button>
						</div>
					</div>
					{selected && (
						<TransactionDetail
							transaction={selected.transaction}
							savedTransaction={selected.savedTransaction}
							accounts={accounts}
							transactions={rows}
							readOnly={readOnly}
							claimScheduleName={
								selected.savedTransaction.claimScheduleId
									? (rows.find(
											(item) =>
												item.id === selected.savedTransaction.claimScheduleId,
										)?.name ?? null)
									: null
							}
							onClose={close}
						/>
					)}
				</>
			) : !occurrences.length ? (
				<Empty className="px-6 py-12">
					<EmptyHeader>
						<EmptyMedia>
							<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
								<ArrowRightLeft size={28} aria-hidden="true" />
							</span>
						</EmptyMedia>
						<h3 className="font-heading text-lg font-medium tracking-tight">
							No transactions for this account yet
						</h3>
					</EmptyHeader>
					<EmptyContent>
						<Button
							type="button"
							onClick={() => onEdit({ kind: "transaction", item: null })}
						>
							Add transaction
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<Empty className="px-6 py-12">
					<EmptyHeader>
						<EmptyMedia>
							<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
								<ListFilter size={28} aria-hidden="true" />
							</span>
						</EmptyMedia>
						<h3 className="font-heading text-lg font-medium tracking-tight">
							No matching transactions
						</h3>
					</EmptyHeader>
					<EmptyContent>
						<Button type="button" onClick={resetFilters}>
							Clear transaction filters
						</Button>
					</EmptyContent>
				</Empty>
			)}
		</>
	);
}
