import { createFileRoute } from "@tanstack/react-router";
import { Outlook } from "../pages/Outlook.tsx";

export const Route = createFileRoute("/outlook")({
	staticData: { page: "outlook" },
	component: Outlook,
});
