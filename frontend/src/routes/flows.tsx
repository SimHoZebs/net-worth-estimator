import { createFileRoute } from "@tanstack/react-router";
import { FlowsPage } from "../pages/flows/FlowsPage.tsx";

export const Route = createFileRoute("/flows")({
	staticData: { page: "flows" },
	component: FlowsPage,
});
