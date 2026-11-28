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
import type { TransferPeerSummary } from "./TransferLinkSection.tsx";
import { findingLabel } from "../../domain/analysisFindings.ts";
import { transactionAmountStyles } from "./activityStyles.ts";
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
	hasTransferLink,
	transferLinksLoaded,
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
	/** Transfer display state resolved once by the owning list. */
	transferPeer: TransferPeerSummary | null;
	hasTransferLink: boolean;
	transferLinksLoaded: boolean;
}) {
	const linkedName =
		transferPeer?.accountName ?? transferPeer?.peerName ?? null;
	const isTransfer =
		Boolean(transferPeer || hasTransferLink) || transaction.flow === "transfer";
	const DirectionIcon = isTransfer
		? ArrowRightLeft
		: transaction.direction === "in"
			? ArrowDownLeft
			: ArrowUpRight;
	const directionIcon = <DirectionIcon size={16} aria-hidden="true" />;
	const showBusinessLogo =
		transferLinksLoaded &&
		!isTransfer &&
		savedTransaction?.kind === "transaction" &&
		Boolean(savedTransaction.recognizedBusinessKey);
	const tone = isTransfer
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
			icon={directionIcon}
			businessKey={
				showBusinessLogo ? savedTransaction.recognizedBusinessKey : undefined
			}
			tone={tone}
			title={transaction.name}
			divider={divider?.tone}
			dividerLabel={divider?.label}
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
								<Badge variant="warning">Excluded from account</Badge>
							)
						)}
						{transaction.shortfall > 0.01 && (
							<Badge variant="warning">
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
