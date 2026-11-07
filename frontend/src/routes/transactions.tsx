import { createFileRoute, useRouter } from "@tanstack/react-router";
import { TransactionsPage } from "../pages/TransactionsPage.tsx";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";

export const Route = createFileRoute("/transactions")({
	staticData: { page: "transactions" },
	component: TransactionsRoute,
});

function TransactionsRoute() {
	const overlays = useWorkspaceOverlays();
	const router = useRouter();
	return (
		<TransactionsPage
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
