import { Ellipsis, Landmark, Link2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import type { Account } from "../../domain/model.ts";
import { useSavedAccounts } from "../../state/savedState.ts";
import { refreshSyncSettings, useSyncLinks } from "../../state/syncSettings.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import {
	refreshAccounts,
	useAccountBalances,
} from "../../state/workspaceResources.ts";
import { SyncLinkAccountDialog } from "./SyncLinkAccountDialog.tsx";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";

export function SyncConnectedAccounts({
	onLinked,
}: {
	onLinked?: (message: string) => void;
}) {
	const links = useSyncLinks();
	const savedAccounts = useSavedAccounts();
	const balancesQuery = useAccountBalances();
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
					!isGroupedDisplay(account) &&
					!account.readOnly &&
					!linkedAccountIDs.has(account.id),
			),
		[linkedAccountIDs, savedAccounts],
	);
	return (
		<div className="border-t border-border p-5 sm:p-6">
			<h3 className="mt-0 mb-4 text-base">Synced accounts</h3>
			{balancesQuery.isError ? (
				<Alert variant="destructive">
					<AlertCircle size={16} aria-hidden="true" />
					<AlertDescription>
						The manual accounts could not be loaded.{" "}
						<Button
							variant="link"
							onClick={() => void refreshAccounts().catch(() => {})}
						>
							Reload
						</Button>
					</AlertDescription>
				</Alert>
			) : null}
			{links.isPending ? (
				<Skeleton className="h-16 w-full" />
			) : links.isError ? (
				<Alert variant="destructive">
					<AlertCircle size={16} aria-hidden="true" />
					<AlertDescription>
						The synced accounts could not be loaded.{" "}
						<Button
							variant="link"
							onClick={() => void refreshSyncSettings(true)}
						>
							Reload
						</Button>
					</AlertDescription>
				</Alert>
			) : links.data.length > 0 ? (
				<ul
					// oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none.
					role="list"
					aria-label="Synced accounts"
					className="m-0 grid list-none gap-3 p-0"
				>
					{links.data.map((link) => {
						const account = byId.get(link.modelAccountId);
						// A synced loan can never absorb a manual account: the server rejects loan components on both sides.
						const canLink =
							account &&
							!isGroupedDisplay(account) &&
							!readOnly &&
							manualAccounts.length > 0;
						return (
							<li
								key={link.bridgeAccountId}
								className="rounded-md border border-border px-4 py-3 text-sm"
							>
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div className="min-w-0">
										{account ? (
											<AccountLabel account={account} />
										) : (
											link.bridgeName || link.modelAccountId
										)}
										{link.institution ? (
											<small className="mt-1 block text-xs text-muted-foreground">
												{link.institution}
												{link.bridgeName ? ` · ${link.bridgeName}` : ""}
											</small>
										) : null}
									</div>
									{canLink ? (
										<DropdownMenu>
											<DropdownMenuTrigger
												render={
													<Button
														variant="ghost"
														size="icon"
														aria-label={
															account
																? `More options for ${account.name}`
																: "More options"
														}
													>
														<Ellipsis size={16} aria-hidden="true" />
													</Button>
												}
											/>
											<DropdownMenuContent
												align="end"
												aria-label="Synced account actions"
											>
												<DropdownMenuItem
													onClick={() =>
														setLinking({
															bridgeAccountId: link.bridgeAccountId,
															syncedAccount: account,
														})
													}
												>
													<Link2 size={14} aria-hidden="true" />
													Link existing account
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<div className="rounded-md border border-dashed border-input bg-muted p-5">
					<Landmark
						size={24}
						aria-hidden="true"
						className="text-muted-foreground"
					/>
					<p className="mt-3 mb-2 text-sm font-semibold">
						No synced accounts yet.
					</p>
					<p className="m-0 text-sm leading-relaxed text-muted-foreground">
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
