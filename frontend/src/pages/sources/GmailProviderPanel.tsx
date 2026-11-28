import { Check, ExternalLink, Mail } from "lucide-react";
import { useId, useState } from "react";
import { AlertCircle } from "lucide-react";
import { ApiError } from "../../api/http.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { Item, ItemContent, ItemDescription } from "@/components/ui/item.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
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
					<Card>
						<CardHeader>
							<div className="flex items-start gap-3">
								<span className="inline-grid size-11 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
									<Mail size={22} aria-hidden="true" />
								</span>
								<div className="min-w-0">
									<CardTitle>
										<h3 className="flex items-center gap-2">
											Gmail
											<Badge variant="secondary">Unavailable</Badge>
										</h3>
									</CardTitle>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							<p className="m-0 text-sm leading-relaxed text-muted-foreground">
								The server administrator has not configured Gmail connection.
								Receipt discovery over Gmail is unavailable until the server
								provides its OAuth credentials.
							</p>
						</CardContent>
					</Card>
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
				<Alert
					variant="default"
					role="note"
					className="border-warning-border bg-warning-bg text-warning-text"
				>
					<AlertDescription className="text-sm text-warning-text">
						This workspace is read-only. You can view the connection details.
						Write access is required to connect, disconnect, or change the scan
						window.
					</AlertDescription>
				</Alert>
			)}
			<div className="grid items-start gap-6 xl:grid-cols-3">
				<div className="min-w-0 xl:col-span-2">
					{connected ? (
						<Card>
							<CardHeader>
								<div className="flex items-start gap-3">
									<span className="inline-grid size-11 shrink-0 place-items-center rounded-md bg-success-bg text-success-text">
										<Mail size={22} aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<CardTitle>
											<h3 className="flex items-center gap-2">
												Gmail
												<Badge
													variant="default"
													className="bg-success-bg text-success-text"
												>
													<Check size={14} aria-hidden="true" />
													Connected
												</Badge>
											</h3>
										</CardTitle>
									</div>
								</div>
							</CardHeader>
							<CardContent className="grid gap-5">
								<Item variant="muted">
									<ItemContent>
										<ItemDescription className="line-clamp-none">
											{credential.data.emailAddress && (
												<>Connected as {credential.data.emailAddress}. </>
											)}
											Read-only access: Waypoint can read messages to find
											receipts. It never sends, deletes, or relabels mail.
										</ItemDescription>
										<ItemDescription className="line-clamp-none">
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
													The first scan looks back{" "}
													{credential.data.lookbackDays} days. Later scans
													resume from where the last one stopped.
												</>
											)}
										</ItemDescription>
									</ItemContent>
								</Item>
								<GmailLookbackEditor
									lookbackDays={credential.data.lookbackDays}
									draft={lookback}
									onDraft={setLookback}
									disabled={readOnly || busy}
									onSave={(days) => void handleLookbackSave(days)}
								/>
								<GmailReceiptsSection readOnly={readOnly} />
							</CardContent>
							<CardFooter>
								{confirmingDisconnect ? (
									<div>
										<p className="mt-0 mb-3 text-sm leading-relaxed text-muted-foreground">
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
							</CardFooter>
						</Card>
					) : (
						<Card>
							<CardHeader>
								<div className="flex items-start gap-3">
									<span className="inline-grid size-11 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
										<Mail size={22} aria-hidden="true" />
									</span>
									<div className="min-w-0">
										<CardTitle>
											<h3>Gmail</h3>
										</CardTitle>
										<CardDescription>
											Connect Gmail so Waypoint can find purchase receipts in
											your mail. Google asks for read-only access to messages;
											Waypoint cannot send, delete, or relabel mail, and the
											grant can be revoked here at any time.
										</CardDescription>
									</div>
								</div>
							</CardHeader>
							<CardContent>
								<Button
									variant="default"
									disabled={readOnly || busy}
									onClick={() => void handleConnect()}
								>
									{busy ? "Starting…" : "Connect Gmail"}
									<ExternalLink size={14} aria-hidden="true" />
								</Button>
							</CardContent>
						</Card>
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
	const lookbackHintId = useId();
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
				<FieldLabel htmlFor={lookbackId}>Initial scan window (days)</FieldLabel>
				<Input
					id={lookbackId}
					name="lookbackDays"
					type="number"
					min={1}
					max={365}
					required
					disabled={disabled}
					aria-describedby={lookbackHintId}
					value={shown}
					onChange={(event) => onDraft(event.target.value)}
				/>
			</Field>
			<p
				id={lookbackHintId}
				className="mt-1 mb-3 text-sm leading-relaxed text-muted-foreground"
			>
				Allowed range: 1–365 days.
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
