import { useState } from "react";
import {
	saveStatementAllocation,
	setStatementAllocationState,
} from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { toStatementPaymentSuggestion } from "@/domain/statementPaymentAdapter.ts";
import {
	refreshCardStatements,
	useStatementPaymentSuggestions,
} from "@/state/cardStatements.ts";

export function useStatementPaymentReview(
	transactionId: string,
	enabled: boolean,
	readOnly: boolean,
	accounts: readonly { id: string; name: string }[],
) {
	const query = useStatementPaymentSuggestions(transactionId, enabled);
	const [selection, setSelection] = useState<{
		transactionId: string;
		statementId: string | null;
	}>();
	const [undoing, setUndoing] = useState(false);
	const [undoError, setUndoError] = useState(false);
	const matches = query.data?.matches ?? [];
	const allocation = query.data?.current;
	const applied = matches.find(
		({ read }) => read.statement.id === allocation?.statementId,
	);
	const current =
		allocation?.state === "confirmed" && applied
			? { allocation, read: applied.read }
			: null;
	const active =
		selection?.transactionId === transactionId
			? matches.find(({ read }) => read.statement.id === selection.statementId)
			: undefined;
	const dismissed =
		selection?.transactionId === transactionId &&
		selection.statementId === null;
	const available = matches.filter(({ read }) => read.remaining > 0);
	const match =
		!current && !dismissed
			? ((active && active.read.remaining > 0 ? active : undefined) ??
				available[0])
			: undefined;
	const suggestion = match
		? toStatementPaymentSuggestion({
				read: match.read,
				paymentAmount: match.payment.amount,
				evidence:
					match.payment.evidence?.some((item) => item.code === "amount-exact")
						? "Payment matches the remaining statement balance."
						: null,
				paymentEvidence: match.payment.evidence?.filter(
					(item) => item.code !== "amount-exact",
				) ?? [],
				alternatives: available
					.filter((candidate) => candidate !== match)
					.map(({ read }) => read),
				actions: {
					apply: !readOnly,
					applyPartial: !readOnly,
					dismiss: !readOnly,
					undo: false,
				},
			})
		: null;

	return {
		suggestion: suggestion && {
			...suggestion,
			accountName: accounts.find(
				({ id }) => id === match?.read.statement.accountId,
			)?.name,
		},
		current,
		undoing,
		undoError,
		choose: (statementId: string) => {
			setSelection({ transactionId, statementId });
			return true;
		},
		dismiss: () => {
			setSelection({ transactionId, statementId: null });
			return true;
		},
		apply: async (statementId: string, amount: number) => {
			const chosen = matches.find(
				({ read }) => read.statement.id === statementId,
			);
			if (readOnly || !chosen) return false;
			const scope = getUserScope();
			try {
				await saveStatementAllocation(statementId, {
					transactionId: chosen.payment.transactionId,
					amount,
					evidence: "",
				});
				await refreshCardStatements(scope);
				return true;
			} catch {
				return false;
			}
		},
		undo: async () => {
			if (readOnly || undoing || !current) return;
			const scope = getUserScope();
			setUndoing(true);
			setUndoError(false);
			try {
				await setStatementAllocationState(current.allocation.id, {
					state: "dismissed",
				});
				setSelection(undefined);
				await refreshCardStatements(scope);
			} catch {
				setUndoError(true);
			} finally {
				setUndoing(false);
			}
		},
	};
}
