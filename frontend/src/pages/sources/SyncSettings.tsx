import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useIntegrations } from "../../state/integrations.ts";
import { IntegrationsList } from "./IntegrationsList.tsx";

export function SyncSettings() {
	const providers = useIntegrations();

	if (providers.isPending || providers.isError) {
		return (
			<Card aria-label="Bank sync">
				<CardContent>
					{providers.isPending ? (
						<Skeleton className="h-10 w-full" />
					) : (
						<Alert variant="destructive">
							<AlertCircle size={16} aria-hidden="true" />
							<AlertDescription>
								The sync connection could not be loaded.{" "}
								<Button variant="link" onClick={() => void providers.refetch()}>
									Retry
								</Button>
							</AlertDescription>
						</Alert>
					)}
				</CardContent>
			</Card>
		);
	}

	return (
		<section aria-label="Bank sync">
			<IntegrationsList providers={providers.data ?? []} />
		</section>
	);
}
