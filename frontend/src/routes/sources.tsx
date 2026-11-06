import { createFileRoute } from "@tanstack/react-router";
import { SourcesPage } from "../pages/SourcesPage.tsx";

export const Route = createFileRoute("/sources")({
	staticData: { page: "sources" },
	component: SourcesPage,
});
