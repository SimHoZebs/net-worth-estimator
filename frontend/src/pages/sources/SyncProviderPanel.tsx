import { Check, ExternalLink, Landmark, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button, TextButton } from "../../components/Button.tsx";
import { buttonStyles } from "../../components/buttonStyles.ts";
import { mergeStyles } from "../../components/mergeStyles.ts";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import type { Account } from "../../domain/model.ts";
import {
	disconnectSyncKey,
	triggerSyncNow,
	useSyncCredential,
} from "../../state/syncSettings.ts";
import { useServerStatus } from "../../state/workspaceResources.ts";
import { SyncConnectedAccounts } from "./SyncConnectedAccounts.tsx";
import { SyncHelp } from "./SyncHelp.tsx";
import { SyncOnboarding } from "./SyncOnboarding.tsx";
import { simplefinLinks } from "./simplefinLinks.ts";

function formatSyncTime(value?: string): string | null {
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

export function SyncProviderPanel({
	accounts,
	readOnly,
}: {
	accounts: Pick<Account, "id" | "kind" | "color" | "name">[];
	readOnly: boolean;
}) {
	const credential = useSyncCredential();
	const configured = credential.data?.configured === true;
	const status = useServerStatus({ enabled: configured });
	const [busy, setBusy] = useState(false);
	const [syncing, setSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const headingRef = useRef<HTMLHeadingElement>(null);
	const wasConfigured = useRef(configured);
	useEffect(() => {
		// The credential refetch lands after the onboarding and disconnect
		// forms report, so move focus once the next container mounts.
		if (configured !== wasConfigured.current) headingRef.current?.focus();
		wasConfigured.current = configured;
	}, [configured]);
	const since = formatSyncTime(credential.data?.updatedAt);
	const lastSynced = formatSyncTime(status.data?.lastSyncAt);
	const syncUnavailable = status.data?.syncConfigured === false;
	const quotaLimit = status.data ? status.data.syncQuotaLimit : null;
	const quotaRemaining =
		status.data && quotaLimit !== null
			? quotaLimit - status.data.syncQuotaUsed
			: null;

	async function handleSyncNow() {
		setSyncing(true);
		setError(null);
		setMessage("");
		const ok = await triggerSyncNow();
		setSyncing(false);
		if (ok) setMessage("Sync complete.");
		else
			setError(
				"Could not sync now. Check the connection in SimpleFIN. If you recently synced or reached a request limit, wait before you try again.",
			);
	}

	async function handleDisconnect() {
		setBusy(true);
		setError(null);
		setMessage("");
		const ok = await disconnectSyncKey();
		setBusy(false);
		setConfirmingDisconnect(false);
		if (ok) {
			setMessage(
				"SimpleFIN disconnected. Your accounts and imported history are kept.",
			);
		} else setError("Could not disconnect. Try again.");
	}

	return (
		<div className="grid gap-6">
			{!configured && (
				<header className="flex flex-wrap items-start justify-between gap-4">
					<h2
						ref={headingRef}
						tabIndex={-1}
						className="m-0 text-xl font-semibold sm:text-2xl"
					>
						Connect bank accounts
					</h2>
					<Badge tone="neutral">Not connected</Badge>
				</header>
			)}

			{readOnly && (
				<p className="m-0 rounded-control border border-warning-border bg-warning-bg p-4 text-sm leading-relaxed text-warning-text">
					This workspace is read-only. You can view the setup guide and
					connection details. Write access is required to connect, disconnect,
					or sync.
				</p>
			)}
			<p
				role="status"
				className={message ? "m-0 text-sm text-success-text" : "sr-only"}
			>
				{message}
			</p>
			{error && <ErrorNotice message={error} />}
			<div className="grid items-start gap-6 xl:grid-cols-3">
				<div className="min-w-0 xl:col-span-2">
					{configured ? (
						<div className="overflow-hidden rounded-surface border border-line bg-surface">
							<div className="p-5 sm:p-6">
								<div className="flex items-start gap-3">
									<span className="inline-grid size-11 shrink-0 place-items-center rounded-control bg-success-bg text-success-text">
										<Landmark size={22} aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<h3
											ref={headingRef}
											tabIndex={-1}
											className="m-0 flex items-center gap-2 text-lg"
										>
											SimpleFIN
											<Badge tone="success">
												<Check size={14} aria-hidden="true" />
												Connected
											</Badge>
										</h3>
									</div>
								</div>
								<div className="my-5 rounded-control border border-line bg-surface-2 p-4">
									<p className="m-0 text-sm leading-relaxed text-muted">
										{since && <>Connected since {since}, </>}
										{lastSynced ? (
											<>
												Last synced{" "}
												<time dateTime={status.data?.lastSyncAt}>
													{lastSynced}
												</time>
											</>
										) : (
											"No successful sync yet"
										)}
										{quotaRemaining !== null && quotaLimit !== null && (
											<>
												, {quotaRemaining} out of {quotaLimit} syncs available
											</>
										)}
										.
									</p>
								</div>
								{status.isError && (
									<ErrorNotice
										message="The sync status could not be loaded."
										action="Reload status"
										onAction={() => void status.refetch()}
									/>
								)}
								{syncUnavailable && (
									<p className="mb-4 text-sm leading-relaxed text-warning-text">
										Your connection is saved, but the server has not enabled
										sync for this user. Ask your server administrator to check
										the sync configuration.
									</p>
								)}
								<div className="flex flex-wrap gap-3">
									<Button
										variant="primary"
										disabled={readOnly || busy || syncing || syncUnavailable}
										onClick={() => void handleSyncNow()}
									>
										<RefreshCw size={16} aria-hidden="true" />
										{syncing ? "Syncing…" : "Sync now"}
									</Button>
									<a
										href={simplefinLinks.home}
										target="_blank"
										rel="noopener noreferrer"
										className={mergeStyles(
											buttonStyles({ variant: "secondary" }),
											"hover:bg-hover",
										)}
									>
										Open SimpleFIN Bridge{" "}
										<ExternalLink size={14} aria-hidden="true" />
										<span className="sr-only"> (opens in a new tab)</span>
									</a>
								</div>
							</div>
							<SyncConnectedAccounts accounts={accounts} />
							<div className="border-t border-line bg-surface-2 px-5 py-4 sm:px-6">
								{confirmingDisconnect ? (
									<div>
										<p className="mt-0 mb-3 text-sm leading-relaxed text-muted">
											Disconnect SimpleFIN? Future imports will stop. Your
											existing accounts and imported history will stay in
											Waypoint.
										</p>
										<div className="flex flex-wrap items-center gap-4">
											<Button
												disabled={busy}
												onClick={() => setConfirmingDisconnect(false)}
											>
												Keep connected
											</Button>
											<TextButton
												tone="danger"
												className="min-h-6"
												disabled={readOnly || busy}
												onClick={() => void handleDisconnect()}
											>
												{busy ? "Disconnecting…" : "Confirm disconnect"}
											</TextButton>
										</div>
									</div>
								) : (
									<TextButton
										tone="danger"
										className="min-h-6"
										disabled={readOnly || busy || syncing}
										onClick={() => setConfirmingDisconnect(true)}
									>
										Disconnect
									</TextButton>
								)}
							</div>
						</div>
					) : (
						<SyncOnboarding
							readOnly={readOnly}
							onConnected={() => {
								setMessage("SimpleFIN connected.");
							}}
						/>
					)}
				</div>
				{!lastSynced && <SyncHelp />}
			</div>
		</div>
	);
}
