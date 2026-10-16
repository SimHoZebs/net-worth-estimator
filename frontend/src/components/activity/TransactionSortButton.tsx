import { ArrowDownUp } from "lucide-react";
import {
	toggleTransactionOrder,
	transactionOrderLabel,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import "./account-activity.css";

export function TransactionSortButton({
	order,
	onChange,
	className = "text-button transaction-order",
}: {
	order: TransactionOrder;
	onChange: (order: TransactionOrder) => void;
	className?: string;
}) {
	const label = transactionOrderLabel(order);
	return (
		<button
			type="button"
			className={className}
			onClick={() => onChange(toggleTransactionOrder(order))}
			aria-label={`Sort transactions: ${label}. Activate to show ${order === "oldest" ? "newest first" : "oldest first"}`}
		>
			<ArrowDownUp size={14} aria-hidden="true" />
			{label}
		</button>
	);
}
