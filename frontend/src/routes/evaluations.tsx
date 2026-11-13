import { createFileRoute } from "@tanstack/react-router";
import { EvaluationsPage } from "../pages/EvaluationsPage.tsx";

export const Route = createFileRoute("/evaluations")({
	staticData: { page: "evaluations" },
	component: EvaluationsPage,
});
