import type { EditorTarget } from "../domain/accountEdits.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../state/savedState.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { Button } from "@/components/ui/button.tsx";
import { FailureEvidence } from "./evidence/FailureEvidence.tsx";
import { SafeSpendingEvidence } from "./evidence/SafeSpendingEvidence.tsx";

export type EvidenceTarget =
	| { kind: "position" }
	| { kind: "failure" }
	| { kind: "safe-spending" };

export function EvidenceDialog({
	target,
	onClose,
}: {
	target: Exclude<EvidenceTarget, { kind: "position" }>;
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
		enabled: true,
	});
	const projection =
		projectionQuery.base instanceof Error ? null : projectionQuery.base;
	const projectionLoading = projectionQuery.loading;
	const projectionError = projectionQuery.baseError;
	const retryProjection = projectionQuery.retryProjection;
	if (!accounts || !transactions || !startDate) return null;
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
							<Button variant="link" onClick={retryProjection}>
								Retry forecast
							</Button>
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
	}
}
