import { ArrowDownUp } from "lucide-react";
import {
	toggleTransactionOrder,
	transactionOrderLabel,
	type TransactionOrder,
} from "../../domain/transactionSort.ts";
import { cn } from "@/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";

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
		<Button
			type="button"
			variant="link"
			className={cn(
				"whitespace-nowrap text-xs max-sm:ml-auto max-sm:min-h-8",
				className,
			)}
			onClick={() => onChange(toggleTransactionOrder(order))}
			aria-label={`Sort transactions: ${label}. Activate to show ${order === "oldest" ? "newest first" : "oldest first"}`}
		>
			<ArrowDownUp size={14} aria-hidden="true" />
			{label}
		</Button>
	);
}
