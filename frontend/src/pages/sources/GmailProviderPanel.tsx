import { Check, ExternalLink, Mail } from "lucide-react";
import { useId, useState } from "react";
import { AlertCircle } from "lucide-react";
import { ApiError } from "../../api/http.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { notifySuccess } from "../../state/notifications.ts";
import {
	disconnectGmail,
	setGmailLookbackDays,
	startGmailConsent,
	useGmailCredential,
} from "../../state/gmail.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import { GmailReceiptsSection } from "./GmailReceiptsSection.tsx";

// Gmail receipt-discovery connection. The server performs OAuth with the
// read-only scope only; tokens stay server-side and never render here.
// Receipt discovery scans Gmail for purchase and refund receipts below.
export function GmailProviderPanel() {
	const credential = useGmailCredential();
	const readOnly = useUserReadOnly();
	const [busy, setBusy] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [lookback, setLookback] = useState<string | null>(null);

	if (credential.isPending) {
		return (
			<div className="grid gap-6">
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}
	if (credential.isError) {
		if (
			credential.error instanceof ApiError &&
			credential.error.status === 503
		) {
			return (
				<div className="grid gap-6">
					<div className="overflow-hidden rounded-surface border border-line bg-surface">
						<div className="p-5 sm:p-6">
							<div className="flex items-start gap-3">
								<span className="inline-grid size-11 shrink-0 place-items-center rounded-control bg-surface-2 text-muted">
									<Mail size={22} aria-hidden="true" />
								</span>
								<div className="min-w-0">
									<h3 className="m-0 flex items-center gap-2 text-lg">
										Gmail
										<Badge variant="secondary">Unavailable</Badge>
									</h3>
								</div>
							</div>
							<p className="mt-4 mb-0 text-sm leading-relaxed text-muted">
								The server administrator has not configured Gmail connection.
								Receipt discovery over Gmail is unavailable until the server
								provides its OAuth credentials.
							</p>
						</div>
					</div>
				</div>
			);
		}
		return (
			<div className="grid gap-6">
				<Alert variant="destructive">
					<AlertCircle size={16} aria-hidden="true" />
					<AlertDescription>
						The Gmail connection could not be loaded.{" "}
						<Button variant="link" onClick={() => void credential.refetch()}>
							Retry
						</Button>
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	const connected = credential.data.connected;

	async function handleConnect() {
		if (readOnly || busy) return;
		setBusy(true);
		// Failures reach the toast from the mutation.
		const started = await startGmailConsent();
		if (!started) {
			setBusy(false);
		}
		// On success the browser leaves for Google; no further local state.
	}

	async function handleDisconnect() {
		if (readOnly || busy) return;
		setBusy(true);
		// Failures reach the toast from the mutation.
		const ok = await disconnectGmail();
		setBusy(false);
		setConfirmingDisconnect(false);
		if (ok) {
			setLookback(null);
			notifySuccess(
				"gmail-notice",
				"Gmail disconnected. Saved tokens are revoked and forgotten.",
			);
		}
	}

	async function handleLookbackSave(days: number) {
		if (readOnly || busy) return;
		setBusy(true);
		const ok = await setGmailLookbackDays(days);
		setBusy(false);
		if (ok) {
			setLookback(null);
			notifySuccess("gmail-notice", `Initial scan window set to ${days} days.`);
		}
	}

	return (
		<div className="grid gap-6">
			{!connected && (
				<header className="flex flex-wrap items-start justify-between gap-4">
					<h2 className="m-0 text-xl font-semibold sm:text-2xl">
						Connect Gmail for receipt discovery
					</h2>
					<Badge variant="secondary">Not connected</Badge>
				</header>
			)}

			{readOnly && (
				<p className="m-0 rounded-control border border-warning-border bg-warning-bg p-4 text-sm leading-relaxed text-warning-text">
					This workspace is read-only. You can view the connection details.
					Write access is required to connect, disconnect, or change the scan
					window.
				</p>
			)}
			<div className="grid items-start gap-6 xl:grid-cols-3">
				<div className="min-w-0 xl:col-span-2">
					{connected ? (
						<div className="overflow-hidden rounded-surface border border-line bg-surface">
							<div className="p-5 sm:p-6">
								<div className="flex items-start gap-3">
									<span className="inline-grid size-11 shrink-0 place-items-center rounded-control bg-success-bg text-success-text">
										<Mail size={22} aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<h3 className="m-0 flex items-center gap-2 text-lg">
											Gmail
											<Badge
												variant="default"
												className="bg-success-bg text-success-text"
											>
												<Check size={14} aria-hidden="true" />
												Connected
											</Badge>
										</h3>
									</div>
								</div>
								<div className="my-5 rounded-control border border-line bg-surface-2 p-4">
									<p className="m-0 text-sm leading-relaxed text-muted">
										{credential.data.emailAddress && (
											<>Connected as {credential.data.emailAddress}. </>
										)}
										Read-only access: Waypoint can read messages to find
										receipts. It never sends, deletes, or relabels mail.
									</p>
									<p className="mt-2 mb-0 text-sm leading-relaxed text-muted">
										{credential.data.lastScanAt ? (
											<>
												Last scan{" "}
												<time dateTime={credential.data.lastScanAt}>
													{credential.data.lastScanAt}
												</time>
												. Later scans resume from where the last one stopped.
											</>
										) : (
											<>
												The first scan looks back {credential.data.lookbackDays}{" "}
												days. Later scans resume from where the last one
												stopped.
											</>
										)}
									</p>
								</div>
								<GmailLookbackEditor
									lookbackDays={credential.data.lookbackDays}
									draft={lookback}
									onDraft={setLookback}
									disabled={readOnly || busy}
									onSave={(days) => void handleLookbackSave(days)}
								/>
								<GmailReceiptsSection readOnly={readOnly} />
							</div>
							<div className="border-t border-line bg-surface-2 px-5 py-4 sm:px-6">
								{confirmingDisconnect ? (
									<div>
										<p className="mt-0 mb-3 text-sm leading-relaxed text-muted">
											Disconnect Gmail? Receipt discovery stops and the saved
											grant is revoked. Your financial records stay in Waypoint.
										</p>
										<div className="flex flex-wrap gap-4">
											<Button
												variant="link"
												className="min-h-6 text-danger-text"
												disabled={readOnly || busy}
												onClick={() => void handleDisconnect()}
											>
												{busy ? "Disconnecting…" : "Yes, disconnect"}
											</Button>
											<Button
												variant="link"
												className="min-h-6"
												disabled={busy}
												onClick={() => setConfirmingDisconnect(false)}
											>
												Keep connected
											</Button>
										</div>
									</div>
								) : (
									<Button
										variant="link"
										className="min-h-6 text-danger-text"
										disabled={readOnly || busy}
										onClick={() => setConfirmingDisconnect(true)}
									>
										Disconnect
									</Button>
								)}
							</div>
						</div>
					) : (
						<div className="overflow-hidden rounded-surface border border-line bg-surface">
							<div className="p-5 sm:p-6">
								<div className="flex items-start gap-3">
									<span className="inline-grid size-11 shrink-0 place-items-center rounded-control bg-surface-2 text-muted">
										<Mail size={22} aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<h3 className="m-0 text-lg">Gmail</h3>
										<p className="mt-2 mb-0 text-sm leading-relaxed text-muted">
											Connect Gmail so Waypoint can find purchase receipts in
											your mail. Google asks for read-only access to messages;
											Waypoint cannot send, delete, or relabel mail, and the
											grant can be revoked here at any time.
										</p>
									</div>
								</div>
								<div className="mt-5 flex flex-wrap gap-3">
									<Button
										variant="default"
										disabled={readOnly || busy}
										onClick={() => void handleConnect()}
									>
										{busy ? "Starting…" : "Connect Gmail"}
										<ExternalLink size={14} aria-hidden="true" />
									</Button>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function GmailLookbackEditor({
	lookbackDays,
	draft,
	onDraft,
	disabled,
	onSave,
}: {
	lookbackDays: number;
	draft: string | null;
	onDraft: (value: string | null) => void;
	disabled: boolean;
	onSave: (days: number) => void;
}) {
	const lookbackId = useId();
	const shown = draft ?? String(lookbackDays);
	const parsed = Number.parseInt(shown, 10);
	const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 365;
	return (
		<form
			method="post"
			aria-label="Initial scan window"
			onSubmit={(event) => {
				event.preventDefault();
				if (valid && parsed !== lookbackDays) onSave(parsed);
			}}
		>
			<Field>
				<Label htmlFor={lookbackId}>Initial scan window (days)</Label>
				<Input
					id={lookbackId}
					name="lookbackDays"
					type="number"
					min={1}
					max={365}
					required
					disabled={disabled}
					value={shown}
					onChange={(event) => onDraft(event.target.value)}
				/>
			</Field>
			<p className="mt-1 mb-3 text-sm leading-relaxed text-muted">
				How far back the first receipt scan looks, from 1 to 365 days.
			</p>
			<Button
				variant="secondary"
				type="submit"
				disabled={disabled || !valid || parsed === lookbackDays}
			>
				Save scan window
			</Button>
		</form>
	);
}
