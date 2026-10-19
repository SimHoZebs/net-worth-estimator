import type { ReactNode } from "react";

export type TransactionTone = "transfer" | "inflow" | "outflow";

/**
 * Single visual transaction row. Domain mapping stays with the callers
 * (plan definitions vs projected occurrences); this owns only the shared
 * table layout, class names, and interaction shape.
 */
export function TransactionItemRow({
	date,
	icon,
	tone,
	title,
	subtitle,
	mobile,
	badges,
	amount,
	actionLabel,
	onSelect,
	selectDisabled = false,
	dimmed = false,
}: {
	date: ReactNode;
	icon: ReactNode;
	tone: TransactionTone;
	title: string;
	subtitle?: ReactNode;
	mobile?: ReactNode;
	badges?: ReactNode;
	amount: ReactNode;
	actionLabel: string;
	onSelect: () => void;
	selectDisabled?: boolean;
	dimmed?: boolean;
}) {
	return (
		<tr className={`transaction-row${dimmed ? " is-excluded" : ""}`}>
			<td className="transaction-date-column">{date}</td>
			<th scope="row">
				<button
					type="button"
					className="transaction-row-button"
					aria-label={actionLabel}
					onClick={onSelect}
					disabled={selectDisabled}
				>
					<span className={`movement-icon ${tone}`}>{icon}</span>
					<span className="transaction-name">
						<strong>{title}</strong>
						{subtitle}
						{mobile}
						{badges}
					</span>
				</button>
			</th>
			<td className="transaction-amount-column">
				<span className="transaction-amount">{amount}</span>
			</td>
		</tr>
	);
}
