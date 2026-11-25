export const SAFE_SPENDING_LABELS = {
	title: "Safe spending",
	transactionsThisCycle: "Transactions this cycle",
	cashAccounts: "Cash accounts",
	cycleBudget: "Cycle budget",
	withCashCushion: "With cash cushion",
	withoutCashCushion: "Without cash cushion",
	afterSavingsGoal: "After savings goal",
	savingsGoalSetAside: "Monthly savings goal (set aside)",
	cashCushion: "Cash cushion",
	unavailable: "Unavailable",
} as const;

export function transactionCycleLabel(count?: number): string {
	if (count == null) return SAFE_SPENDING_LABELS.transactionsThisCycle;
	return `${count} ${count === 1 ? "transaction" : "transactions"} this cycle`;
}
