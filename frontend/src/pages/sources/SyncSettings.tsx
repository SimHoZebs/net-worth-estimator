import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { useIntegrations } from "../../state/integrations.ts";
import { IntegrationsList } from "./IntegrationsList.tsx";

export function SyncSettings() {
	const providers = useIntegrations();

	if (providers.isPending || providers.isError) {
		return (
			<section
				aria-label="Bank sync"
				className="rounded-control border border-line bg-surface p-4"
			>
				{providers.isPending ? (
					<Skeleton className="h-10 w-full" />
				) : (
					<ErrorNotice
						message="The sync connection could not be loaded."
						action="Retry"
						onAction={() => void providers.refetch()}
					/>
				)}
			</section>
		);
	}

	return (
		<section aria-label="Bank sync">
			<IntegrationsList providers={providers.data ?? []} />
		</section>
	);
}
