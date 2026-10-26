import { useState } from "react";
import { Landmark } from "lucide-react";
import { Badge } from "../../components/Badge.tsx";
import { Button, TextButton } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import {
	Checkbox,
	InputField,
	TextAreaField,
} from "../../components/Field.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import {
	connectSyncKey,
	disconnectSyncKey,
	refreshSyncSettings,
	saveSyncCards,
	useSyncCards,
	useSyncCredential,
} from "../../state/syncSettings.ts";

const BRIDGE_CREATE_URL = "https://bridge.simplefin.org/simplefin/create";

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

export function SyncSettings({
	accounts,
	readOnly,
}: {
	accounts: { id: string; name: string }[];
	readOnly: boolean;
}) {
	const credential = useSyncCredential();
	const cards = useSyncCards();
	const [token, setToken] = useState("");
	const [accessUrl, setAccessUrl] = useState("");
	const [busy, setBusy] = useState<"connect" | "disconnect" | "cards" | null>(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [selected, setSelected] = useState<string[] | null>(null);

	const info = credential.data;
	const configured = info?.configured === true;
	const storedCards = cards.data ?? [];
	const checked = selected ?? storedCards;
	const dirty =
		selected !== null &&
		(selected.length !== storedCards.length ||
			selected.some((id) => !storedCards.includes(id)));

	async function handleConnect(input: {
		setupToken?: string;
		accessUrl?: string;
	}) {
		setBusy("connect");
		setError(null);
		const ok = await connectSyncKey(input);
		setBusy(null);
		if (ok) {
			setToken("");
			setAccessUrl("");
		} else {
			setError(
				"The bank could not be connected. Check the token and try again.",
			);
		}
	}

	async function handleDisconnect() {
		setBusy("disconnect");
		setError(null);
		const ok = await disconnectSyncKey();
		setBusy(null);
		setConfirmingDisconnect(false);
		if (!ok) setError("The bank could not be disconnected. Try again.");
	}

	async function handleSaveCards() {
		if (selected === null) return;
		setBusy("cards");
		setError(null);
		const ok = await saveSyncCards(selected);
		setBusy(null);
		if (ok) {
			setSelected(null);
		} else {
			setError("The card selection could not be saved. Try again.");
		}
	}

	return (
		<section
			aria-label="Bank sync"
			className="mb-6 rounded-surface border border-line bg-surface p-6 max-sm:p-5"
		>
			<div className="mb-2 flex items-center gap-4">
				<span className="text-primary-text">
					<Landmark size={25} />
				</span>
				<div className="flex-1">
					<h2 className="text-base max-sm:text-sm">Bank sync.</h2>
					<p className="m-0 text-sm text-muted">
						Pull balances and pending card charges from your bank through
						SimpleFIN.
					</p>
				</div>
				{credential.data !== undefined && (
					<Badge tone={configured ? "outline" : "neutral"}>
						{configured ? "Connected" : "Not connected"}
					</Badge>
				)}
			</div>

			{credential.isPending ? (
				<Skeleton className="h-10 w-full" />
			) : credential.isError ? (
				<ErrorNotice message="The sync connection could not be loaded." />
			) : info?.configured === true ? (
				<>
					<p className="text-sm text-muted">
						Connected{info.bridgeHost ? ` to ${info.bridgeHost}` : ""}
						{formatConnectedAt(info.updatedAt)
							? ` · since ${formatConnectedAt(info.updatedAt)}`
							: ""}
						.
					</p>
					{error && <ErrorNotice message={error} />}
					<div className="mt-4">
						<span
							id="sync-cards-label"
							className="text-sm font-semibold text-muted"
						>
							Card accounts
						</span>
						<p className="m-0 text-xs leading-relaxed text-muted">
							Only these accounts receive pending-charge seeds.
						</p>
						{cards.isPending ? (
							<Skeleton className="mt-2 h-10 w-full" />
						) : cards.isError ? (
							<ErrorNotice
								message="The card selection could not be loaded."
								action="Reload cards"
								onAction={() => void refreshSyncSettings(true)}
							/>
						) : (
							<>
								<ul
									aria-labelledby="sync-cards-label"
									className="mt-2 grid list-none gap-2 p-0"
								>
									{accounts.map((account) => (
										<li
											key={account.id}
											className="flex items-center gap-2 text-sm"
										>
											<label className="flex items-center gap-2">
												<Checkbox
													checked={checked.includes(account.id)}
													disabled={readOnly || busy !== null}
													onChange={(event) => {
														const next = event.currentTarget.checked
															? [...checked, account.id]
															: checked.filter((id) => id !== account.id);
														setSelected(next);
													}}
												/>{" "}
												{account.name}
											</label>
										</li>
									))}
									{accounts.length === 0 && (
										<li className="text-sm text-muted">No accounts yet.</li>
									)}
								</ul>
								<div className="mt-3">
									<Button
										type="button"
										variant="secondary"
										disabled={readOnly || busy !== null || !dirty}
										onClick={() => void handleSaveCards()}
									>
										{busy === "cards" ? "Saving…" : "Save cards"}
									</Button>
								</div>
							</>
						)}
					</div>
					<div className="mt-3">
						<TextButton
							type="button"
							tone="danger"
							disabled={readOnly || busy !== null}
							onClick={() => setConfirmingDisconnect(true)}
						>
							Disconnect
						</TextButton>
					</div>
					{confirmingDisconnect && (
						<ConfirmDialog
							title="Disconnect bank sync?"
							eyebrow="SimpleFIN"
							onCancel={() => setConfirmingDisconnect(false)}
							onConfirm={() => void handleDisconnect()}
							cancelLabel="Keep connected"
							confirmLabel="Disconnect"
							busyLabel="Disconnecting…"
							busy={busy === "disconnect"}
						>
							<p className="text-sm text-muted">
								Synced balances and pending charges stay in your model. Future
								syncs stop until you connect a new key.
							</p>
						</ConfirmDialog>
					)}
				</>
			) : (
				<>
					<p className="text-sm text-muted">
						<a href={BRIDGE_CREATE_URL} target="_blank" rel="noreferrer">
							Get a setup token from the SimpleFIN Bridge
						</a>
						, then paste it below. The token is claimed once and never stored.
					</p>
					{error && <ErrorNotice message={error} />}
					<TextAreaField
						label="Setup token"
						hint="The long token from the Bridge. Claimed once, then it stops working."
						value={token}
						rows={3}
						autoComplete="off"
						disabled={readOnly || busy !== null}
						onChange={(event) => setToken(event.currentTarget.value)}
						placeholder="Paste your SimpleFIN setup token"
					/>
					<div className="mt-3">
						<Button
							type="button"
							disabled={
								readOnly ||
								busy !== null ||
								token.trim() === "" ||
								accessUrl.trim() !== ""
							}
							onClick={() => void handleConnect({ setupToken: token.trim() })}
						>
							{busy === "connect" ? "Connecting…" : "Connect bank"}
						</Button>
					</div>
					<details className="mt-4 text-sm">
						<summary className="cursor-pointer text-muted">
							Already have an access URL?
						</summary>
						<div className="mt-3">
							<InputField
								label="Access URL"
								hint="An already-claimed Bridge access URL."
								type="password"
								autoComplete="off"
								value={accessUrl}
								disabled={readOnly || busy !== null}
								onChange={(event) => setAccessUrl(event.currentTarget.value)}
								placeholder="https://user:pass@host/simplefin"
							/>
							<div className="mt-3">
								<Button
									type="button"
									variant="secondary"
									disabled={
										readOnly ||
										busy !== null ||
										accessUrl.trim() === "" ||
										token.trim() !== ""
									}
									onClick={() =>
										void handleConnect({ accessUrl: accessUrl.trim() })
									}
								>
									{busy === "connect" ? "Connecting…" : "Connect with URL"}
								</Button>
							</div>
						</div>
					</details>
				</>
			)}
		</section>
	);
}
