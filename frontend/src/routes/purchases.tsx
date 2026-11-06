import { createFileRoute } from "@tanstack/react-router";
import { PurchasesPage } from "../pages/PurchasesPage.tsx";

export const Route = createFileRoute("/purchases")({
	staticData: { page: "purchases" },
	component: PurchasesPage,
});
