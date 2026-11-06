import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Outlook } from "../pages/Outlook.tsx";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/outlook")({
	staticData: { page: "outlook" },
	component: OutlookRoute,
});

function OutlookRoute() {
	const navigate = useNavigate();
	const overlays = useWorkspaceOverlays();
	return (
		<Outlook
			onAddAccount={() => overlays.openEditor({ kind: "account", item: null })}
			onEvidence={() => overlays.openEvidence({ kind: "position" })}
			onFailure={() => overlays.openEvidence({ kind: "failure" })}
			onTransactions={() => void navigate({ to: "/transactions" })}
			safeSpendingDetail={overlays.safeSpendingDetail}
			onSafeSpendingDetail={(tab) => {
				if (tab) overlays.openSafeSpendingDetail(tab);
				else overlays.closeSafeSpendingDetail();
			}}
			onSafeSpendingTab={overlays.switchSafeSpendingTab}
		/>
	);
}
