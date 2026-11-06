import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../pages/AccountsPage.tsx";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/accounts")({
	staticData: { page: "accounts" },
	component: AccountsRoute,
});

function AccountsRoute() {
	const overlays = useWorkspaceOverlays();
	return (
		<AccountsPage
			onEdit={overlays.openEditor}
			onAccount={(id) => overlays.openEvidence({ kind: "account", id })}
		/>
	);
}
