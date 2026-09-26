import { Pencil } from "lucide-react";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import { exactMoney } from "../../domain/format.ts";
import type { Movement } from "../../domain/model.ts";
import { DetailRow } from "../DetailRow.tsx";

export function TransactionDetails({
	transaction,
	movement,
	onEdit,
}: {
	transaction: AccountTransaction;
	movement: Movement | null;
	onEdit: (movement: Movement) => void;
}) {
	return (
		<div className="transaction-details">
			<dl>
				<DetailRow label="From">{transaction.from}</DetailRow>
				<DetailRow label="To">{transaction.to}</DetailRow>
				<DetailRow
					label={
						transaction.source === "recorded" ? "Recorded amount" : "Requested"
					}
				>
					{exactMoney(transaction.requested)}
				</DetailRow>
				{transaction.source === "projected" && (
					<DetailRow label="Funded in the base case">
						{exactMoney(transaction.amount)}
					</DetailRow>
				)}
				{transaction.shortfall > 0.01 && (
					<>
						<DetailRow label="Unfunded amount">
							{exactMoney(transaction.shortfall)}
						</DetailRow>
						<DetailRow label="Limiting constraint">
							{transaction.constraint}
						</DetailRow>
					</>
				)}
			</dl>
			{transaction.excluded && (
				<p>
					This recorded movement is excluded from plan evidence. It remains
					visible as a source record.
				</p>
			)}
			{transaction.source === "projected" && (
				<p>
					{transaction.shortfall > 0.01
						? "The unfunded amount is not automatically borrowed or rescheduled. "
						: ""}
					This is a dated occurrence of a planned movement, not a bank-confirmed
					transaction.
					{movement && movement.frequency !== "once"
						? " Editing this movement changes every occurrence in its schedule."
						: ""}
				</p>
			)}
			{movement && (
				<button
					type="button"
					className="text-button"
					onClick={() => onEdit(movement)}
				>
					<Pencil size={14} />
					{movement.readOnly
						? "Inspect source record"
						: transaction.source === "recorded"
							? "Edit recorded movement"
							: "Edit planned movement"}
				</button>
			)}
		</div>
	);
}
