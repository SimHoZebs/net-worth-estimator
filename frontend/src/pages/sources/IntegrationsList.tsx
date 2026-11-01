import type { ProviderEntry } from "@/api/generated/model/index.ts";
import { GmailProviderPanel } from "./GmailProviderPanel.tsx";
import { SyncProviderPanel } from "./SyncProviderPanel.tsx";

// Provider list for the integrations management page. Each registered
// provider renders its own section; unknown provider IDs render nothing
// because their UI ships with the provider that registers them. An empty
// (or fully unknown) list falls back to the shipped sections: a blank page
// would only ever mean a wiring mistake, never "no integrations".
export function IntegrationsList({
	providers,
}: {
	providers: ProviderEntry[];
}) {
	const known = providers.filter(
		(provider) => provider.id === "simplefin" || provider.id === "gmail",
	);
	// Each provider renders its own labeled section: badges such as
	// "Not connected" and live regions repeat per provider, so shared
	// queries would stay ambiguous to assistive technology and tests.
	if (known.length === 0) {
		return (
			<div className="grid gap-6">
				<section aria-label="SimpleFIN">
					<SyncProviderPanel key="simplefin" />
				</section>
				<section aria-label="Gmail">
					<GmailProviderPanel key="gmail" />
				</section>
			</div>
		);
	}
	return (
		<div className="grid gap-6">
			{known.map((provider) =>
				provider.id === "gmail" ? (
					<section aria-label="Gmail" key={provider.id}>
						<GmailProviderPanel />
					</section>
				) : (
					<section aria-label="SimpleFIN" key={provider.id}>
						<SyncProviderPanel />
					</section>
				),
			)}
		</div>
	);
}
