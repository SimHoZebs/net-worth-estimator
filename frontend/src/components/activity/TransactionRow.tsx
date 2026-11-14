import {
	ArrowDownLeft,
	ArrowRightLeft,
	ArrowUpRight,
	ReceiptText,
	TriangleAlert,
} from "lucide-react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { externalCounterpartyName } from "../../domain/accountActivity.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import type { Transaction } from "../../domain/model.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { TransactionItemRow } from "./TransactionItem.tsx";
import { useTransactionBNPL } from "../analysis/TransactionAnalysis.tsx";
import { useTransferLinks } from "../../state/analyses.ts";
import {
	useSavedAccounts,
	useSavedTransactions,
} from "../../state/savedState.ts";
import {
	resolveTransferPeer,
	type TransferPeerSummary,
} from "./TransferLinkSection.tsx";
import { transferLinkForEdge } from "../../pages/flows/TransferMatchNote.tsx";
import { findingLabel } from "../../domain/analysisFindings.ts";
import {
	transactionAmountStyles,
	transactionDividerLabelStyles,
} from "./activityStyles.ts";
import { cn } from "@/lib/utils.ts";

export function TransactionRow({
	transaction,
	savedTransaction,
	onEdit,
	shortfallLabel,
	divider,
	shortfall,
	onRemove,
	removing,
	transferPeer,
}: {
	transaction: AccountTransaction;
	savedTransaction: Transaction | null;
	onEdit: (savedTransaction: Transaction) => void;
	shortfallLabel?: string;
	divider?: { tone: "warning" | "danger"; label: string };
	shortfall?: boolean;
	/** Direct removal that keeps the row click-through intact. */
	onRemove?: () => void;
	removing?: boolean;
	/**
	 * Linked transfer peer drilled from the list. Undefined resolves the
	 * link through the cached transfer-link query; null means unlinked.
	 */
	transferPeer?: TransferPeerSummary | null;
}) {
	const linksQuery = useTransferLinks();
	const savedTransactions = useSavedTransactions();
	const savedAccounts = useSavedAccounts();
	const resolved =
		transferPeer !== undefined
			? transferPeer
			: savedTransaction
				? resolveTransferPeer({
						transactionId: savedTransaction.id,
						link: transferLinkForEdge(linksQuery.data?.links ?? [], [
							savedTransaction.id,
						]),
						transactions: savedTransactions,
						accounts: savedAccounts,
					})
				: null;
	const linkedName = resolved?.accountName ?? resolved?.peerName ?? null;
	const DirectionIcon =
		resolved || transaction.flow === "transfer"
			? ArrowRightLeft
			: transaction.direction === "in"
				? ArrowDownLeft
				: ArrowUpRight;
	const tone =
		resolved || transaction.flow === "transfer"
			? ("transfer" as const)
			: transaction.direction === "in"
				? ("inflow" as const)
				: ("outflow" as const);
	const action = "View";
	// Counterparties that only restate the direction ("External
	// income/spending" just means in/out) carry no information the icon
	// does not already show. Real accounts still show.
	const counterparty =
		transaction.counterparty === externalCounterpartyName("in") ||
		transaction.counterparty === externalCounterpartyName("out")
			? null
			: transaction.counterparty;
	// A confirmed transfer link names the linked account even though the
	// counterparty itself is external and normally hidden.
	const labelCounterparty = linkedName ?? counterparty;
	const receipts = savedTransaction?.receiptIds ?? [];
	const finding = useTransactionBNPL(savedTransaction?.id ?? "");
	const analysisBadge =
		finding &&
		savedTransaction?.kind === "transaction" &&
		!transaction.pending &&
		!transaction.void ? (
			<Badge variant="secondary">{findingLabel(finding)}</Badge>
		) : null;
	const receiptBadge =
		savedTransaction && receipts.length > 0 ? (
			<Badge variant="secondary">
				<ReceiptText size={10} aria-hidden="true" />
				{receipts.length}
				<span className="sr-only">
					{receipts.length === 1 ? "1 receipt" : `${receipts.length} receipts`}
				</span>
			</Badge>
		) : null;
	return (
		<TransactionItemRow
			date={
				<time dateTime={transaction.date}>
					{dateLabel(transaction.date, true)}
				</time>
			}
			icon={<DirectionIcon size={16} aria-hidden="true" />}
			tone={tone}
			title={transaction.name}
			divider={divider?.tone}
			shortfall={transaction.shortfall > 0.01 && shortfall}
			slots={{
				subtitle: labelCounterparty && (
					<span>
						{transaction.direction === "in" ? "From" : "To"} {labelCounterparty}
					</span>
				),
				mobile: (
					<time dateTime={transaction.date}>
						{dateLabel(transaction.date, true)}
					</time>
				),
				badges: (transaction.void ||
					transaction.excluded ||
					transaction.shortfall > 0.01 ||
					receiptBadge ||
					analysisBadge) && (
					<>
						{analysisBadge}
						{receiptBadge}{" "}
						{transaction.void ? (
							<Badge variant="secondary">
								Did not post
								<span className="sr-only">bank hold that did not post</span>
							</Badge>
						) : (
							transaction.excluded && (
								<Badge
									variant="secondary"
									className="bg-warning-bg text-warning-text"
								>
									Excluded from account
								</Badge>
							)
						)}
						{transaction.shortfall > 0.01 && (
							<Badge
								variant="secondary"
								className="bg-warning-bg text-warning-text"
							>
								<TriangleAlert size={10} />
								{shortfallLabel ?? "Shortfall"}
							</Badge>
						)}
					</>
				),
			}}
			amount={
				<>
					<strong
						className={cn(
							transactionAmountStyles({
								positive: transaction.direction === "in",
							}),
							transaction.shortfall > 0.01 && shortfall && "text-warning-text",
						)}
					>
						{transaction.amount === 0
							? exactMoney(0)
							: `${transaction.direction === "in" ? "+" : "−"}${exactMoney(transaction.amount)}`}
					</strong>
					{transaction.pending ? (
						<Badge variant="secondary">Pending</Badge>
					) : null}
					{transaction.shortfall > 0.01 && (
						<small className="block text-xs text-warning-text">
							{exactMoney(transaction.requested)} planned
						</small>
					)}
					{divider && (
						<small
							className={transactionDividerLabelStyles({ tone: divider.tone })}
						>
							{divider.label}
						</small>
					)}
					{onRemove && (
						<Button
							type="button"
							variant="link"
							className="text-destructive"
							disabled={removing}
							onClick={(event) => {
								event.stopPropagation();
								onRemove();
							}}
							aria-label={`Remove ${transaction.name} from history`}
						>
							{removing ? "Removing…" : "Remove"}
						</Button>
					)}
				</>
			}
			actionLabel={`${action} ${transaction.name} on ${dateLabel(transaction.date, true)}${labelCounterparty ? `; ${transaction.direction === "in" ? "money in from" : "money out to"} ${labelCounterparty}` : ""}${transaction.shortfall > 0.01 ? "; shortfall" : ""}${divider ? `; ${divider.label}` : ""}${transaction.void ? "; did not post" : transaction.pending ? "; pending" : transaction.excluded ? "; excluded from account" : ""}${analysisBadge && finding ? `; ${findingLabel(finding)}` : ""}`}
			onSelect={() => {
				if (savedTransaction) onEdit(savedTransaction);
			}}
			selectDisabled={!savedTransaction}
		/>
	);
}
