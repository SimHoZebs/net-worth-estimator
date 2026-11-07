import { Landmark, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { ActionMenu } from "../../components/ActionMenu.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import type { Account } from "../../domain/model.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import { refreshSyncSettings, useSyncLinks } from "../../state/syncSettings.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { SyncLinkAccountDialog } from "./SyncLinkAccountDialog.tsx";

export function SyncConnectedAccounts({
	onLinked,
}: {
	onLinked?: (message: string) => void;
}) {
	const links = useSyncLinks();
	const savedAccounts = useSavedAccounts();
	const readOnly = useUserReadOnly();
	const [linking, setLinking] = useState<{
		bridgeAccountId: string;
		syncedAccount: Account;
	} | null>(null);
	const byId = new Map(
		(savedAccounts ?? []).map((account) => [account.id, account]),
	);
	const linkedAccountIDs = useMemo(
		() => new Set((links.data ?? []).map((link) => link.modelAccountId)),
		[links.data],
	);
	const manualAccounts = useMemo(
		() =>
			(savedAccounts ?? []).filter(
				(account) =>
					!account.display &&
					!account.readOnly &&
					!linkedAccountIDs.has(account.id),
			),
		[linkedAccountIDs, savedAccounts],
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
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0">
										{account ? (
											<AccountLabel account={account} />
										) : (
											link.bridgeName || link.modelAccountId
										)}
										{link.institution ? (
											<small className="mt-1 block text-xs text-muted">
												{link.institution}
												{link.bridgeName ? ` · ${link.bridgeName}` : ""}
											</small>
										) : null}
									</div>
									<ActionMenu
										label={
											account
												? `More options for ${account.name}`
												: "More options"
										}
										menuLabel="Synced account actions"
										items={
											account && !readOnly && manualAccounts.length > 0
												? [
														{
															id: "link-existing-account",
															label: "Link existing account",
															icon: Link2,
															restoreFocus: false,
															onSelect: () =>
																setLinking({
																	bridgeAccountId: link.bridgeAccountId,
																	syncedAccount: account,
																}),
														},
													]
												: []
										}
									/>
								</div>
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
			{linking && (
				<SyncLinkAccountDialog
					bridgeAccountId={linking.bridgeAccountId}
					syncedAccount={linking.syncedAccount}
					manualAccounts={manualAccounts}
					onClose={() => setLinking(null)}
					onLinked={(manualAccount) => {
						setLinking(null);
						onLinked?.(
							`${manualAccount.name} is linked to the bank account. The manual record and its history were removed.`,
						);
					}}
				/>
			)}
		</div>
	);
}
