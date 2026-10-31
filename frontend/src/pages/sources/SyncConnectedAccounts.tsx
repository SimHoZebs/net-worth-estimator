import { Landmark } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { useSavedAccounts } from "../../state/savedRows.ts";
import { refreshSyncSettings, useSyncLinks } from "../../state/syncSettings.ts";

export function SyncConnectedAccounts() {
	const links = useSyncLinks();
	const savedAccounts = useSavedAccounts();
	const byId = new Map(
		(savedAccounts ?? []).map((account) => [account.id, account]),
	);
	return (
		<div className="border-t border-line p-5 sm:p-6">
			<h3 className="mt-0 mb-4 text-base">Synced accounts</h3>
			{links.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : links.isError ? (
				<ErrorNotice
					message="The synced accounts could not be loaded."
					action="Reload"
					onAction={() => void refreshSyncSettings(true)}
				/>
			) : links.data.length > 0 ? (
				<ul
					// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
					role="list"
					aria-label="Synced accounts"
					className="m-0 grid list-none gap-3 p-0"
				>
					{links.data.map((link) => {
						const account = byId.get(link.modelAccountId);
						return (
							<li
								key={link.bridgeAccountId}
								className="rounded-control border border-line px-4 py-3 text-sm"
							>
								{account ? (
									<AccountLabel account={account} />
								) : (
									link.bridgeName || link.modelAccountId
								)}
							</li>
						);
					})}
				</ul>
			) : (
				<div className="rounded-control border border-dashed border-line-strong bg-surface-2 p-5">
					<Landmark size={24} aria-hidden="true" className="text-muted" />
					<p className="mt-3 mb-2 text-sm font-semibold">
						No synced accounts yet.
					</p>
					<p className="m-0 text-sm leading-relaxed text-muted">
						No bank accounts have been imported. Confirm your banks are
						connected in SimpleFIN, then choose Sync now.
					</p>
				</div>
			)}
		</div>
	);
}
