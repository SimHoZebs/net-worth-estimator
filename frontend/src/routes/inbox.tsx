import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "../pages/InboxPage.tsx";

export const Route = createFileRoute("/inbox")({
	staticData: { page: "inbox" },
	component: InboxPage,
});
