import { useState } from "react";
import { Link2 } from "lucide-react";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import { ApiHttpError } from "../../api/http.ts";
import { Button } from "../Button.tsx";
import { ErrorNotice, FieldError } from "../ErrorNotice.tsx";
import type { Account, Transaction } from "../../domain/model.ts";
import {
	useAnalysisFindings,
	useConfirmTransferPair,
	useRemoveTransferLinkByLeg,
	useTransferLinks,
} from "../../state/analyses.ts";
import {
	useSavedAccounts,
	useSavedTransactions,
} from "../../state/savedState.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";
import {
	transferFindingsForEdge,
	transferLinkForEdge,
	transferPeers,
} from "../../pages/flows/TransferMatchNote.tsx";

/** Peer leg resolved for display: its name plus its own account. */
export interface TransferPeerSummary {
	peerId: string;
	peerName: string | null;
	accountName: string | null;
}

/**
 * Names the other side of a confirmed link. The peer keeps its own
 * account: prefer a peer account the current leg does not share, then the
 * peer's primary account. Unknown accounts stay null so callers fall back
 * to the peer name.
 */
export function resolveTransferPeer({
	transactionId,
	link,
	transactions,
	accounts,
}: {
	transactionId: string;
	link: TransferLink | undefined;
	transactions:
		| Pick<Transaction, "id" | "name" | "fromId" | "toId">[]
		| null
		| undefined;
	accounts: Pick<Account, "id" | "name">[] | null | undefined;
}): TransferPeerSummary | null {
	if (!link) return null;
	const peerId = link.legA === transactionId ? link.legB : link.legA;
	const byId = new Map((transactions ?? []).map((row) => [row.id, row]));
	const self = byId.get(transactionId);
	const peer = byId.get(peerId);
	const names = new Map(
		(accounts ?? []).map((account) => [account.id, account.name]),
	);
	const selfIds = new Set(
		[self?.fromId, self?.toId].filter(
			(id): id is string => typeof id === "string",
		),
	);
	const peerIds = [peer?.toId, peer?.fromId].filter(
		(id): id is string => typeof id === "string",
	);
	const accountId =
		peerIds.find((id) => !selfIds.has(id)) ?? peerIds[0] ?? null;
	return {
		peerId,
		peerName: peer?.name ?? null,
		accountName: accountId ? (names.get(accountId) ?? null) : null,
	};
}

/**
 * Transfer pairing for one transaction row. A linked leg names the other
 * side with an Unlink action; an observed-but-unlinked leg offers the
 * detector-ranked peers best-first. With neither a finding nor a link the
 * section renders nothing, so plain income and spending stay untouched.
 */
export function TransferLinkSection({
	transactionId,
	readOnly: readOnlyProp,
}: {
	transactionId: string;
	/** Write-permission override; production reads server policy. */
	readOnly?: boolean;
}) {
	const scopeReadOnly = useUserReadOnly();
	const readOnly = readOnlyProp ?? scopeReadOnly;
	const findingsQuery = useAnalysisFindings([transactionId]);
	const linksQuery = useTransferLinks();
	const savedTransactions = useSavedTransactions();
	const savedAccounts = useSavedAccounts();
	const confirm = useConfirmTransferPair();
	const unlink = useRemoveTransferLinkByLeg();
	const [selectedPeer, setSelectedPeer] = useState<string | null>(null);

	const findings = transferFindingsForEdge(findingsQuery.data?.findings ?? [], [
		transactionId,
	]);
	const actionable =
		findings
			.map((finding) => ({ finding, peers: transferPeers(finding) }))
			.filter((entry) => entry.peers.length > 0)
			.sort((a, b) => a.peers.length - b.peers.length)[0] ?? null;
	const peers = actionable?.peers ?? [];
	const peer =
		selectedPeer && peers.includes(selectedPeer)
			? selectedPeer
			: (peers[0] ?? null);
	const link = transferLinkForEdge(linksQuery.data?.links ?? [], [
		transactionId,
	]);
	const busy = confirm.isPending || unlink.isPending;
	const failure = confirm.isError
		? confirm.error
		: unlink.isError
			? unlink.error
			: null;
	const inlineError =
		failure instanceof ApiHttpError && failure.status === 422
			? (failure.detail ??
				"These two transactions cannot be linked as one transfer.")
			: null;
	const noticeError =
		failure && !inlineError
			? failure instanceof Error
				? failure.message
				: "The transfer pair could not be saved."
			: null;

	if (!link && !actionable) return null;

	if (link) {
		const resolution = resolveTransferPeer({
			transactionId,
			link,
			transactions: savedTransactions,
			accounts: savedAccounts,
		});
		const self = savedTransactions?.find((row) => row.id === transactionId);
		const direction =
			self != null
				? self.fromId
					? ("out" as const)
					: ("in" as const)
				: actionable?.finding.role === "inflow"
					? ("in" as const)
					: ("out" as const);
		const title = resolution?.accountName
			? direction === "out"
				? `Transfer to ${resolution.accountName}`
				: `Transfer from ${resolution.accountName}`
			: "Linked as transfer";
		return (
			<section
				aria-label="Transfer link"
				className="mt-4 border-t border-line pt-4"
			>
				<p className="flex items-center gap-2 text-xs">
					<Link2 size={15} aria-hidden="true" />
					<strong>{title}</strong>
					{resolution?.peerName && (
						<span className="min-w-0 truncate text-muted">
							{resolution.peerName}
						</span>
					)}
				</p>
				<p className="mt-1 text-xs text-muted">
					Counted once as a transfer, not as income plus spending.
				</p>
				{!readOnly && (
					<div className="mt-2">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={busy}
							aria-label={`Unlink the confirmed transfer touching ${transactionId}`}
							onClick={() => unlink.mutate({ transactionId })}
						>
							{unlink.isPending ? "Unlinking…" : "Unlink"}
						</Button>
					</div>
				)}
				<FieldError message={inlineError} />
				<ErrorNotice message={noticeError} />
			</section>
		);
	}

	if (!actionable) return null;
	const peerOptions = peers.map((peerId) => {
		const peerRow = savedTransactions?.find((row) => row.id === peerId);
		const accountId = peerRow?.toId ?? peerRow?.fromId ?? null;
		const accountName = accountId
			? (savedAccounts?.find((account) => account.id === accountId)?.name ??
				null)
			: null;
		return {
			peerId,
			label: peerRow?.name ?? peerId,
			accountName,
		};
	});
	const confirmPair = () => {
		if (!actionable || !peer || busy) return;
		confirm.mutate({
			id: actionable.finding.id,
			peerTransactionId: peer,
		});
	};
	return (
		<section
			aria-label="Transfer link"
			className="mt-4 border-t border-line pt-4"
		>
			<p className="flex items-center gap-2 text-xs">
				<Link2 size={15} aria-hidden="true" />
				<strong>Possible transfer</strong>
			</p>
			<p className="mt-1 text-xs text-muted">
				Counted once as a transfer, not as income plus spending.
			</p>
			{!readOnly && peers.length === 1 && (
				<div className="mt-2">
					<Button
						type="button"
						size="sm"
						disabled={busy || !peer}
						aria-label={`Link as transfer with ${peer}`}
						onClick={confirmPair}
					>
						{confirm.isPending ? "Linking…" : "Link as transfer"}
					</Button>
				</div>
			)}
			{!readOnly && peers.length > 1 && (
				<fieldset disabled={busy} className="mt-2 space-y-2 border-0 p-0">
					<legend className="text-xs font-semibold">
						Which transaction is the opposite side?
					</legend>
					<div className="space-y-1">
						{peerOptions.map((option) => (
							<label
								key={option.peerId}
								className="flex items-center gap-2 text-xs"
							>
								<input
									type="radio"
									name={`transfer-peer-${actionable.finding.id}`}
									value={option.peerId}
									checked={peer === option.peerId}
									onChange={() => setSelectedPeer(option.peerId)}
								/>
								<span>
									{option.label}
									{option.accountName ? ` · ${option.accountName}` : ""}
								</span>
							</label>
						))}
					</div>
					<Button
						type="button"
						size="sm"
						disabled={busy || !peer}
						aria-label={`Link as transfer with ${peer}`}
						onClick={confirmPair}
					>
						{confirm.isPending ? "Linking…" : "Link as transfer"}
					</Button>
				</fieldset>
			)}
			<FieldError message={inlineError} />
			<ErrorNotice message={noticeError} />
		</section>
	);
}
