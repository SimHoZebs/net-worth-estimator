import { ArrowDownUp } from "lucide-react";
import {
	toggleTransactionOrder,
	transactionOrderLabel,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { mergeStyles } from "../mergeStyles.ts";
import { TextButton } from "../Button.tsx";

export function TransactionSortButton({
	order,
	onChange,
	className,
}: {
	order: TransactionOrder;
	onChange: (order: TransactionOrder) => void;
	className?: string;
}) {
	const label = transactionOrderLabel(order);
	return (
		<TextButton
			type="button"
			className={mergeStyles(
				"whitespace-nowrap text-xs [@media(max-width:600px)]:ml-auto [@media(max-width:600px)]:min-h-8",
				className,
			)}
			onClick={() => onChange(toggleTransactionOrder(order))}
			aria-label={`Sort transactions: ${label}. Activate to show ${order === "oldest" ? "newest first" : "oldest first"}`}
		>
			<ArrowDownUp size={14} aria-hidden="true" />
			{label}
		</TextButton>
	);
}
