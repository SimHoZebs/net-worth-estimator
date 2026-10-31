import type { EditorTarget } from "../domain/accountEdits.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../state/savedRows.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { AccountDialog } from "./AccountDialog.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { SafeSpendingEvidence } from "./evidence/SafeSpendingEvidence.tsx";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "account"; id: string }
	| { kind: "failure" }
	| { kind: "safe-spending" };

export function EvidenceDialog({
	target,
	temporary = false,
	onClose,
	onEdit,
}: {
	target: Exclude<EvidenceTarget, { kind: "position" }>;
	temporary?: boolean;
	onClose: () => void;
	onEdit: (target: EditorTarget) => void;
}) {
	// Each evidence view subscribes to its own queries; only the target
	// selection and UI callbacks arrive as props.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	const projectionQuery = useRemoteProjection({
		ranges: false,
		// The account view loads its forecast only on explicit request
		// inside AccountDialog; do not prefetch it here.
		enabled: target.kind !== "account",
	});
	const projection =
		projectionQuery.base instanceof Error ? null : projectionQuery.base;
	const projectionLoading = projectionQuery.loading;
	const projectionError = projectionQuery.baseError;
	const retryProjection = projectionQuery.retryProjection;
	if (!accounts || !transactions || !startDate) return null;
	// The editor replaces the evidence in the URL overlay slot, so the
	// evidence unmounts on navigation: no separate close is needed, and the
	// back button returns to this evidence.
	const edit = (next: EditorTarget) => {
		onEdit(next);
	};
	switch (target.kind) {
		case "failure":
		case "safe-spending": {
			if (!projection) {
				if (projectionLoading) {
					return <p role="status">Loading forecast…</p>;
				}
				return (
					<p role="alert">
						{projectionError ?? "Forecast unavailable."}{" "}
						{retryProjection ? (
							<button type="button" onClick={retryProjection}>
								Retry forecast
							</button>
						) : null}
					</p>
				);
			}
			if (target.kind === "failure") {
				return (
					<FailureEvidence
						accounts={accounts}
						transactions={transactions}
						startDate={startDate}
						readOnly={readOnly}
						projection={projection}
						failure={projection.firstFailure}
						onClose={onClose}
					/>
				);
			}
			return (
				<SafeSpendingEvidence
					startDate={startDate}
					projection={projection}
					onClose={onClose}
				/>
			);
		}
		case "account": {
			const account = accounts.find(
				(item) => item.id === target.id && !item.archived,
			);
			return account ? (
				<AccountDialog
					key={account.id}
					account={account}
					accounts={accounts}
					transactions={transactions}
					startDate={startDate}
					readOnly={readOnly}
					temporary={temporary}
					onClose={onClose}
					onEdit={edit}
				/>
			) : null;
		}
	}
}
