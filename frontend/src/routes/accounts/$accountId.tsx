import { createFileRoute } from "@tanstack/react-router";
import { AccountDetailPage } from "../../pages/accounts/AccountDetailPage.tsx";

export const Route = createFileRoute("/accounts/$accountId")({
	component: AccountDetailRoute,
});

function AccountDetailRoute() {
	const { accountId } = Route.useParams();
	return <AccountDetailPage accountId={accountId} />;
}
