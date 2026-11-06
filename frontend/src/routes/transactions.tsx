import { createFileRoute } from "@tanstack/react-router";
import { TransactionsPage } from "../pages/TransactionsPage.tsx";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/transactions")({
	staticData: { page: "transactions" },
	component: TransactionsRoute,
});

function TransactionsRoute() {
	const overlays = useWorkspaceOverlays();
	return (
		<TransactionsPage
			onEdit={overlays.openEditor}
			onAccount={(id) => overlays.openEvidence({ kind: "account", id })}
		/>
	);
}
