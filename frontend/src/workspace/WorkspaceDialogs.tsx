import { Suspense, lazy } from "react";
import { WorkspaceEditor } from "../components/WorkspaceEditor.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	useSavedAccounts,
	useSavedTransactions,
	useSavedStartDate,
} from "../state/savedRows.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import type { WorkspaceOverlays } from "./useWorkspaceOverlays.ts";

const EvidenceDialog = lazy(() =>
	import("../components/EvidenceDialog.tsx").then((module) => ({
		default: module.EvidenceDialog,
	})),
);
const CurrentPositionDialog = lazy(() =>
	import("../components/evidence/CurrentPositionDialog.tsx").then((module) => ({
		default: module.CurrentPositionDialog,
	})),
);

export function WorkspaceEvidence({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const accounts = useSavedAccounts();
	if (!overlays.evidence) return null;
	if (overlays.evidence.kind === "position")
		return accounts ? (
			<Suspense fallback={<Skeleton className="h-32 w-full" />}>
				<CurrentPositionDialog
					accounts={accounts}
					onClose={overlays.closeEvidence}
				/>
			</Suspense>
		) : null;
	return <WorkspaceEvidenceLoaded overlays={overlays} />;
}

function WorkspaceEvidenceLoaded({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const readOnly = useUserReadOnly();
	if (
		!overlays.evidence ||
		overlays.evidence.kind === "position" ||
		!accounts ||
		!transactions ||
		!startDate
	)
		return null;
	// Account activity and details render from saved rows alone; the dialog
	// loads its own forecast only for projected activity/metrics.
	if (overlays.evidence.kind === "account") {
		return (
			<Suspense fallback={<Skeleton className="h-32 w-full" />}>
				<EvidenceDialog
					target={overlays.evidence}
					accounts={accounts}
					transactions={transactions}
					startDate={startDate}
					readOnly={readOnly}
					projection={null}
					onClose={overlays.closeEvidence}
					onEdit={overlays.editFromEvidence}
				/>
			</Suspense>
		);
	}
	return (
		<WorkspaceProjectedEvidence
			overlays={overlays}
			accounts={accounts}
			transactions={transactions}
			startDate={startDate}
			readOnly={readOnly}
		/>
	);
}

function WorkspaceProjectedEvidence({
	overlays,
	accounts,
	transactions,
	startDate,
	readOnly,
}: {
	overlays: WorkspaceOverlays;
	accounts: NonNullable<ReturnType<typeof useSavedAccounts>>;
	transactions: NonNullable<ReturnType<typeof useSavedTransactions>>;
	startDate: string;
	readOnly: boolean;
}) {
	const projection = useRemoteProjection({ ranges: false });
	const base = projection.base instanceof Error ? null : projection.base;
	if (!overlays.evidence || overlays.evidence.kind === "position") return null;
	return (
		<Suspense fallback={<Skeleton className="h-32 w-full" />}>
			<EvidenceDialog
				target={overlays.evidence}
				accounts={accounts}
				transactions={transactions}
				startDate={startDate}
				readOnly={readOnly}
				projection={base}
				projectionLoading={projection.loading}
				projectionError={projection.baseError}
				retryProjection={projection.retryProjection}
				onClose={overlays.closeEvidence}
				onEdit={overlays.editFromEvidence}
			/>
		</Suspense>
	);
}

export function WorkspaceDialogs({
	overlays,
}: {
	overlays: WorkspaceOverlays;
}) {
	return overlays.editor ? (
		<WorkspaceEditor target={overlays.editor} onClose={overlays.closeEditor} />
	) : null;
}
