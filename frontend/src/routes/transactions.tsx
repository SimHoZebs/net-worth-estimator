import { createFileRoute } from "@tanstack/react-router";
import { TransactionsPage } from "../pages/TransactionsPage.tsx";

export const Route = createFileRoute("/transactions")({
	staticData: { page: "transactions" },
	component: TransactionsPage,
});
