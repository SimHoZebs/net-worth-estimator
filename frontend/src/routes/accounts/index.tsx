import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AccountsPage } from "../../pages/AccountsPage.tsx";
import { useWorkspaceOverlays } from "../../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/accounts/")({
	component: AccountsIndexRoute,
});

function AccountsIndexRoute() {
	const overlays = useWorkspaceOverlays();
	const router = useRouter();
	return (
		<AccountsPage
			onEdit={overlays.openEditor}
			onAccount={(id) =>
				void router.navigate({
					to: "/accounts/$accountId",
					params: { accountId: id },
				})
			}
		/>
	);
}
