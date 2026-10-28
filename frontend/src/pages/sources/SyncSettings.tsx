import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import type { Account } from "../../domain/model.ts";
import { useSyncCredential } from "../../state/syncSettings.ts";
import { SyncProviderPanel } from "./SyncProviderPanel.tsx";

type SyncAccount = Pick<Account, "id" | "kind" | "color" | "name">;

export function SyncSettings({
	accounts,
	readOnly,
}: {
	accounts: SyncAccount[];
	readOnly: boolean;
}) {
	const credential = useSyncCredential();

	if (credential.isPending || credential.isError) {
		return (
			<section
				aria-label="Bank sync"
				className="rounded-control border border-line bg-surface p-4"
			>
				{credential.isPending ? (
					<Skeleton className="h-10 w-full" />
				) : (
					<ErrorNotice
						message="The sync connection could not be loaded."
						action="Retry"
						onAction={() => void credential.refetch()}
					/>
				)}
			</section>
		);
	}

	return (
		<section aria-label="Bank sync">
			<SyncProviderPanel accounts={accounts} readOnly={readOnly} />
		</section>
	);
}
