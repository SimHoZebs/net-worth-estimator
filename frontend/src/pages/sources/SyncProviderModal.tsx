import { useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button, TextButton } from "../../components/Button.tsx";
import { Checkbox } from "../../components/Field.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import {
	disconnectSyncKey,
	refreshSyncSettings,
	saveSyncCards,
	useSyncCards,
	useSyncCredential,
	useSyncLinks,
} from "../../state/syncSettings.ts";

const PROVIDERS = [{ id: "simplefin", name: "SimpleFIN" }] as const;

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
	accounts: { id: string; name: string }[];
	readOnly: boolean;
	onClose: () => void;
	onConnect: () => void;
}) {
	const credential = useSyncCredential();
	const cards = useSyncCards();
	const configured = credential.data?.configured === true;
	const links = useSyncLinks(configured);
	const [busy, setBusy] = useState<"disconnect" | "cards" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [selected, setSelected] = useState<string[] | null>(null);

	const storedCards = cards.data ?? [];
	const checked = selected ?? storedCards;
	const dirty =
		selected !== null &&
		(selected.length !== storedCards.length ||
			selected.some((id) => !storedCards.includes(id)));
	const names = new Map(accounts.map((account) => [account.id, account.name]));
	const linked = (links.data ?? []).map(
		(link) => names.get(link.modelAccountId) ?? link.bridgeName,
	);

	async function handleDisconnect() {
		setBusy("disconnect");
		setError(null);
		const ok = await disconnectSyncKey();
		setBusy(null);
		setConfirmingDisconnect(false);
		if (!ok) setError("Could not disconnect. Try again.");
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
			setError("Could not save the card selection. Try again.");
		}
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
									{configured && (
										<p className="m-0 text-xs text-muted">
											{credential.data?.bridgeHost ?? "Bridge"}
											{formatConnectedAt(credential.data?.updatedAt)
												? ` · since ${formatConnectedAt(credential.data?.updatedAt)}`
												: ""}
											{links.data !== undefined &&
												(linked.length > 0
													? ` · syncs ${linked.join(", ")}`
													: " · no linked accounts yet")}
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
											id="sync-cards-label"
											className="text-sm font-semibold text-muted"
										>
											Card accounts
										</span>
										<p className="m-0 text-xs leading-relaxed text-muted">
											Only these accounts receive pending-charge seeds.
										</p>
										{cards.isPending || links.isPending ? (
											<Skeleton className="mt-2 h-10 w-full" />
										) : cards.isError || links.isError ? (
											<ErrorNotice
												message="The sync details could not be loaded."
												action="Reload"
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
																			: checked.filter(
																					(id) => id !== account.id,
																				);
																		setSelected(next);
																	}}
																/>{" "}
																{account.name}
															</label>
														</li>
													))}
													{accounts.length === 0 && (
														<li className="text-sm text-muted">
															No accounts yet.
														</li>
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
										{confirmingDisconnect ? (
											<div className="flex items-center gap-3">
												<Button
													type="button"
													variant="secondary"
													disabled={busy !== null}
													onClick={() => setConfirmingDisconnect(false)}
												>
													Keep connected
												</Button>
												<TextButton
													type="button"
													tone="danger"
													disabled={readOnly || busy !== null}
													onClick={() => void handleDisconnect()}
												>
													{busy === "disconnect"
														? "Disconnecting…"
														: "Confirm disconnect"}
												</TextButton>
											</div>
										) : (
											<TextButton
												type="button"
												tone="danger"
												disabled={readOnly || busy !== null}
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
