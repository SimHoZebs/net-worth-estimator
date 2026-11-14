import { TriangleAlert } from "lucide-react";
import { dateLabel } from "../../domain/format.ts";
import { failureLedger } from "../../domain/constraintSnapshot.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { TransactionResult, Projection } from "../../domain/result.ts";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { ConstraintSnapshot } from "./ConstraintSnapshot.tsx";

export function FailureEvidence({
	accounts,
	transactions,
	startDate,
	readOnly,
	projection,
	failure,
	onClose,
}: {
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	projection: Projection;
	failure: TransactionResult | null;
	onClose: () => void;
}) {
	if (!failure)
		return (
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
			>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>All transactions funded</DialogTitle>
					</DialogHeader>
					<p>No underfunded transactions occur in this projection horizon.</p>
				</DialogContent>
			</Dialog>
		);
	const ledger = failureLedger({
		accounts,
		transactions,
		startDate,
		projection,
		failure,
	});
	// The table names the transaction, so the heading names the event instead
	// of repeating it.
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>First underfunded transaction</DialogTitle>
				</DialogHeader>
				{!ledger && (
					<div className="flex items-center gap-2 text-xs text-warning-text">
						<TriangleAlert size={18} />
						{dateLabel(failure.date, true)}
					</div>
				)}
				{ledger && (
					<ConstraintSnapshot
						ledger={ledger}
						failure={failure}
						accounts={accounts}
						transactions={transactions}
						readOnly={readOnly}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
