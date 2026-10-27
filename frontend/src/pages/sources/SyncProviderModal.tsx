import { useState } from "react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Button, TextButton } from "../../components/Button.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import type { Account } from "../../domain/model.ts";
import {
	disconnectSyncKey,
	refreshSyncSettings,
	useSyncCredential,
	useSyncLinks,
} from "../../state/syncSettings.ts";

const PROVIDERS = [{ id: "simplefin", name: "SimpleFIN" }] as const;

type SyncAccount = Pick<Account, "id" | "kind" | "color" | "name">;

function formatConnectedAt(value?: string): string | null {
	if (!value) return null;
	const time = new Date(value);
	if (Number.isNaN(time.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(time);
}

export function SyncProviderModal({
	accounts,
	readOnly,
	onClose,
	onConnect,
}: {
	accounts: SyncAccount[];
	readOnly: boolean;
	onClose: () => void;
	onConnect: () => void;
}) {
	const credential = useSyncCredential();
	const configured = credential.data?.configured === true;
	const links = useSyncLinks(configured);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

	const byId = new Map(accounts.map((account) => [account.id, account]));
	const synced = (links.data ?? []).flatMap((link) => {
		const account = byId.get(link.modelAccountId);
		return account ? [account] : [];
	});
	const orphaned = (links.data ?? [])
		.filter((link) => !byId.has(link.modelAccountId))
		.map((link) => ({
			id: link.bridgeAccountId || link.modelAccountId,
			name: link.bridgeName || link.modelAccountId,
		}));
	const since = configured
		? formatConnectedAt(credential.data?.updatedAt)
		: null;

	async function handleDisconnect() {
		setBusy(true);
		setError(null);
		const ok = await disconnectSyncKey();
		setBusy(false);
		setConfirmingDisconnect(false);
		if (!ok) setError("Could not disconnect. Try again.");
	}

	return (
		<Modal title="Bank sync" eyebrow="Providers" onClose={onClose}>
			{credential.isPending ? (
				<Skeleton className="h-10 w-full" />
			) : credential.isError ? (
				<ErrorNotice message="The sync connection could not be loaded." />
			) : (
				<ul className="grid list-none gap-4 p-0">
					{PROVIDERS.map((provider) => (
						<li
							key={provider.id}
							className="rounded-control border border-line p-4"
						>
							<div className="flex items-center gap-4">
								<div className="flex-1">
									<h3 className="m-0 text-sm">{provider.name}</h3>
									{since && (
										<p className="m-0 text-xs text-muted">
											Connected since {since}.
										</p>
									)}
								</div>
								<Badge tone={configured ? "outline" : "neutral"}>
									{configured ? "Connected" : "Not connected"}
								</Badge>
							</div>

							{error && <ErrorNotice message={error} />}

							{configured ? (
								<>
									<div className="mt-4">
										<span
											id="sync-accounts-label"
											className="text-sm font-semibold text-muted"
										>
											Synced accounts
										</span>
										{links.isPending ? (
											<Skeleton className="mt-2 h-10 w-full" />
										) : links.isError ? (
											<ErrorNotice
												message="The synced accounts could not be loaded."
												action="Reload"
												onAction={() => void refreshSyncSettings(true)}
											/>
										) : (
											<ul
												aria-labelledby="sync-accounts-label"
												className="mt-2 grid list-none gap-2 p-0"
											>
												{synced.map((account) => (
													<li
														key={account.id}
														className="flex items-center gap-2 text-sm"
													>
														<AccountLabel account={account} />
													</li>
												))}
												{orphaned.map((orphan) => (
													<li
														key={`bridge-${orphan.id}`}
														className="text-sm text-muted"
													>
														{orphan.name}
													</li>
												))}
												{synced.length === 0 && orphaned.length === 0 && (
													<li className="text-sm text-muted">
														No synced accounts yet.
													</li>
												)}
											</ul>
										)}
									</div>
									<div className="mt-3">
										{confirmingDisconnect ? (
											<div className="flex items-center gap-3">
												<Button
													type="button"
													variant="secondary"
													disabled={busy}
													onClick={() => setConfirmingDisconnect(false)}
												>
													Keep connected
												</Button>
												<TextButton
													type="button"
													tone="danger"
													disabled={readOnly || busy}
													onClick={() => void handleDisconnect()}
												>
													{busy ? "Disconnecting…" : "Confirm disconnect"}
												</TextButton>
											</div>
										) : (
											<TextButton
												type="button"
												tone="danger"
												disabled={readOnly || busy}
												onClick={() => setConfirmingDisconnect(true)}
											>
												Disconnect
											</TextButton>
										)}
										<p className="m-0 mt-2 text-xs text-muted">
											Synced rows stay. Future syncs stop until you connect a
											new key.
										</p>
									</div>
								</>
							) : (
								<div className="mt-3">
									<Button type="button" disabled={readOnly} onClick={onConnect}>
										Connect {provider.name}
									</Button>
								</div>
							)}
						</li>
					))}
				</ul>
			)}
		</Modal>
	);
}
