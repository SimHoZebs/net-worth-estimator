import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { useSyncCredential } from "../../state/syncSettings.ts";
import { SyncProviderPanel } from "./SyncProviderPanel.tsx";

export function SyncSettings() {
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
			<SyncProviderPanel />
		</section>
	);
}
