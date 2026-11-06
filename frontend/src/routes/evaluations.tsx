import { createFileRoute } from "@tanstack/react-router";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/evaluations")({
	staticData: { page: "evaluations" },
	component: EvaluationsRoute,
});

function EvaluationsRoute() {
	const overlays = useWorkspaceOverlays();
	return (
		<EvaluationsPage
			onEdit={(item) => overlays.openEditor({ kind: "evaluation", item })}
		/>
	);
}
