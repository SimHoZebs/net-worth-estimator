import type { ProviderEntry } from "@/api/generated/model/index.ts";
import { SyncProviderPanel } from "./SyncProviderPanel.tsx";

// Provider list for the integrations management page. Each registered
// provider renders its own section; unknown provider IDs render nothing
// because their UI ships with the provider that registers them. An empty
// (or fully unknown) list falls back to the SimpleFIN section: it is the
// only provider with shipped UI, so a blank section would only ever mean a
// wiring mistake, never "no integrations".
export function IntegrationsList({
	providers,
}: {
	providers: ProviderEntry[];
}) {
	const known = providers.filter(
		(provider) => provider.id === "simplefin",
	);
	if (known.length === 0) {
		return (
			<div className="grid gap-6">
				<SyncProviderPanel key="simplefin" />
			</div>
		);
	}
	return (
		<div className="grid gap-6">
			{known.map((provider) => (
				<SyncProviderPanel key={provider.id} />
			))}
		</div>
	);
}
