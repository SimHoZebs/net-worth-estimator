import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../../pages/AccountsPage.tsx";

export const Route = createFileRoute("/accounts/")({
	component: AccountsPage,
});
