import { Link2 } from "lucide-react";
import { useState } from "react";
import { AccountToggle } from "../../components/AccountToggle.tsx";
import { Button } from "../../components/Button.tsx";
import { dialogActionsStyles } from "../../components/dialogStyles.ts";
import { FieldError } from "../../components/ErrorNotice.tsx";
import { Modal } from "../../components/Modal.tsx";
import { Notice } from "../../components/Notice.tsx";
import type { Account } from "../../domain/model.ts";
import { supersedeSyncedAccount } from "../../state/syncSettings.ts";

/**
 * One synced account absorbs one manual account. The manual account is the
 * account the user maintained before the bank connection appeared; the
 * synced account stays authoritative for bank facts.
 */
export function SyncLinkAccountDialog({
	bridgeAccountId,
	syncedAccount,
	manualAccounts,
	onClose,
	onLinked,
}: {
	bridgeAccountId: string;
	syncedAccount: Account;
	manualAccounts: Account[];
	onClose: () => void;
	onLinked: (manualAccount: Account) => void;
}) {
	const [selectedID, setSelectedID] = useState<string | null>(
		manualAccounts.length === 1 ? (manualAccounts[0]?.id ?? null) : null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selected =
		manualAccounts.find((account) => account.id === selectedID) ?? null;

	async function link() {
		if (!selected || busy) return;
		setBusy(true);
		setError(null);
		try {
			const ok = await supersedeSyncedAccount(
				bridgeAccountId,
				selected.id,
				setError,
			);
			setBusy(false);
			if (ok) onLinked(selected);
		} catch (cause) {
			setBusy(false);
			setError(cause instanceof Error ? cause.message : "Linking failed.");
		}
	}

	return (
		<Modal
			title="Link a manual account"
			eyebrow="Bank sync"
			onClose={onClose}
			onCloseRequest={() => !busy}
		>
			<p className="m-0 text-sm leading-relaxed text-muted">
				Choose the manual account that <strong>{syncedAccount.name}</strong>{" "}
				replaces. The synced account keeps its bridge link and imported bank
				history.
			</p>
			{manualAccounts.length === 0 ? (
				<Notice tone="info" className="m-0">
					No manual accounts are available. Every account is already synced or
					read-only.
				</Notice>
			) : (
				<div
					role="group"
					aria-label="Manual accounts to link"
					className="grid max-h-64 gap-2 overflow-y-auto p-1"
				>
					{manualAccounts.map((account) => (
						<AccountToggle
							key={account.id}
							account={account}
							checked={account.id === selectedID}
							disabled={busy}
							onToggle={() => {
								setError(null);
								setSelectedID(account.id);
							}}
							className="w-full"
						/>
					))}
				</div>
			)}
			<Notice tone="warning" className="m-0">
				The manual account and its history are permanently deleted. Sharing
				permissions that include it will apply to the synced account, including
				its imported bank history.
			</Notice>
			<FieldError message={error} />
			<div className={dialogActionsStyles}>
				<Button
					type="button"
					variant="secondary"
					onClick={onClose}
					disabled={busy}
				>
					Cancel
				</Button>
				<Button
					type="button"
					variant="danger"
					disabled={!selected || busy}
					onClick={() => void link()}
				>
					<Link2 size={16} aria-hidden="true" />
					{busy ? "Linking…" : "Link account"}
				</Button>
			</div>
		</Modal>
	);
}
