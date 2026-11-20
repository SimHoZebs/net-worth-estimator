import { toDerivedCardStatement } from "@/domain/statementPaymentAdapter.ts";
import { useCardStatements } from "@/state/cardStatements.ts";
import { CardStatementsList } from "./CardStatementsList.tsx";

/**
 * Account surface for card statements. Statements are derived from recorded
 * cycle ends; the owner does not enter or edit them here.
 */
export function AccountStatements({ accountId }: { accountId: string }) {
	const statements = useCardStatements(accountId);
	const state = statements.isError
		? "error"
		: statements.isPending
			? "pending"
			: "ready";
	return (
		<CardStatementsList
			statements={statements.data?.map(toDerivedCardStatement) ?? []}
			state={state}
			onRetry={() => void statements.refetch()}
		/>
	);
}
