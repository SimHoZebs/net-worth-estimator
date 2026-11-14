import { useState } from "react";
import type { AnalysisFinding } from "../../api/generated/model/analysisFinding.ts";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import { ApiHttpError } from "../../api/http.ts";
import { UserScopeError } from "../../api/scopedRequest.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	useAnalysisFindings,
	useConfirmTransferPair,
	useRemoveTransferLinkByLeg,
	useTransferLinks,
} from "../../state/analyses.ts";
import {
	dismissKey,
	notifyError,
	notifySuccess,
} from "../../state/notifications.ts";
import { cn } from "@/lib/utils.ts";
import { useUserReadOnly } from "../../state/useUserScope.ts";

/** Read-only transfer-pair annotation (VIS-03 consumer) with confirm actions.
 * The VIS-03 `Transfer` analyzer (backend/internal/analysis/transfer.go)
 * publishes one detection per observed leg with kind "transfer": strength
 * "strong" for a matched pair with no rival or a clear scoring winner,
 * "moderate" with all candidates ranked best-first when several match.
 * Transfer edges are counted once in transfer totals — never as income plus
 * spending — and this note shows what the matcher observed about the
 * opposite leg. A strong leg links directly; an ambiguous leg offers the
 * ranked candidates inline; a confirmed link unlinks by either leg. */
export function transferFindingsForEdge(
	findings: AnalysisFinding[],
	transactionIds: string[],
): AnalysisFinding[] {
	if (!transactionIds.length) return [];
	const ids = new Set(transactionIds);
	return findings.filter(
		(finding) =>
			finding.kind === "transfer" &&
			!finding.dismissed &&
			finding.review?.decision !== "rejected" &&
			ids.has(finding.transactionId),
	);
}

/** Detector-ranked opposite legs best-first: evidence TransactionIDs[0] is
 * the observed leg itself, so peers are the remaining ids in order. */
export function transferPeers(finding: AnalysisFinding): string[] {
	const seen = new Set([finding.transactionId]);
	const peers: string[] = [];
	for (const evidence of finding.evidence ?? [])
		for (const id of evidence.transactionIds ?? [])
			if (!seen.has(id)) {
				seen.add(id);
				peers.push(id);
			}
	return peers;
}

/** Confirmed link touching any leg of the edge, when one is observed. */
export function transferLinkForEdge(
	links: TransferLink[],
	transactionIds: string[],
): TransferLink | undefined {
	const ids = new Set(transactionIds);
	return links.find((link) => ids.has(link.legA) || ids.has(link.legB));
}

export function TransferMatchNote({
	transactionIds,
	transferCount,
	readOnly: readOnlyProp,
}: {
	transactionIds: string[];
	/** Number of source transactions behind the edge. */
	transferCount: number;
	/** Write-permission override; production reads server policy. */
	readOnly?: boolean;
}) {
	const scopeReadOnly = useUserReadOnly();
	const readOnly = readOnlyProp ?? scopeReadOnly;
	const query = useAnalysisFindings(transactionIds);
	const linksQuery = useTransferLinks();
	const confirm = useConfirmTransferPair();
	const unlink = useRemoveTransferLinkByLeg();
	const [selectedPeer, setSelectedPeer] = useState<string | null>(null);
	const findings = transferFindingsForEdge(
		query.data?.findings ?? [],
		transactionIds,
	);
	const matched = findings.filter((finding) => finding.strength === "strong");
	const ambiguous = findings.filter((finding) => finding.strength !== "strong");
	const actionable = findings
		.map((finding) => ({ finding, peers: transferPeers(finding) }))
		.filter((entry) => entry.peers.length > 0)
		.sort((a, b) => a.peers.length - b.peers.length)[0];
	const peers = actionable?.peers ?? [];
	const peer =
		selectedPeer && peers.includes(selectedPeer) ? selectedPeer : peers[0];
	const link = transferLinkForEdge(
		linksQuery.data?.links ?? [],
		transactionIds,
	);
	const unlinkLeg = link
		? (transactionIds.find((id) => id === link.legA || id === link.legB) ??
			link.legA)
		: null;
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
	// Non-validation link failures reach the decoupled toast: the note fires
	// one keyed toast from the mutation callbacks instead of mirroring the
	// outcome inline. The 422 reason above stays with its control. Retired
	// scopes stay silent: the mutation already threw a UserScopeError.
	function reportLinkFailure(cause: unknown, fallback: string): void {
		if (cause instanceof UserScopeError) return;
		if (cause instanceof ApiHttpError && cause.status === 422) return;
		const message = cause instanceof Error ? cause.message : fallback;
		notifyError("transfer-link", message);
	}
	const matcherDetail = actionable?.finding.evidence?.[0]?.reason ?? null;
	const confirmPair = () => {
		if (!actionable || !peer || busy) return;
		confirm.mutate(
			{
				id: actionable.finding.id,
				peerTransactionId: peer,
			},
			{
				onError: (cause) =>
					reportLinkFailure(cause, "The transfer pair could not be saved."),
				onSuccess: () => {
					dismissKey("transfer-link");
					notifySuccess("transfer-notice", "The transfer pair was saved.");
				},
			},
		);
	};
	return (
		<div className="mt-3 border-t border-border pt-3">
			<p className="text-xs text-muted-foreground">
				Counted once as a transfer
				{transferCount > 1 ? ` across ${transferCount} transactions` : ""}, not
				as income plus spending.
			</p>
			{query.isError ? (
				<p className="mt-1 text-xs text-muted-foreground">
					Transfer-pair information could not be loaded.
				</p>
			) : matched.length > 0 ? (
				<p className="mt-1 text-xs text-success-text">
					Both sides of this transfer are observed.
				</p>
			) : ambiguous.length > 0 ? (
				<p className="mt-1 text-xs text-warning-text">
					Several possible matching transfers were found; the true opposite side
					is not settled yet.
				</p>
			) : (
				<p className="mt-1 text-xs text-muted-foreground">
					No matching opposite transfer is confirmed yet.
				</p>
			)}
			{!readOnly && link && unlinkLeg && (
				<div className="mt-2 space-y-2">
					<p className="m-0 text-xs font-semibold text-success-text">
						Linked as transfer.
					</p>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={busy}
						aria-label={`Unlink the confirmed transfer touching ${unlinkLeg}`}
						onClick={() =>
							unlink.mutate(
								{ transactionId: unlinkLeg },
								{
									onError: (cause) =>
										reportLinkFailure(
											cause,
											"The transfer link could not be removed.",
										),
									onSuccess: () => {
										dismissKey("transfer-link");
										notifySuccess(
											"transfer-notice",
											"The transfer link was removed.",
										);
									},
								},
							)
						}
					>
						{unlink.isPending ? "Unlinking…" : "Unlink"}
					</Button>
				</div>
			)}
			{!readOnly && !link && actionable && actionable.peers.length === 1 && (
				<div className="mt-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={busy || !peer}
						aria-label={`Link as transfer with ${peer}`}
						onClick={confirmPair}
					>
						{confirm.isPending ? "Linking…" : "Link as transfer"}
					</Button>
				</div>
			)}
			{!readOnly && !link && actionable && actionable.peers.length > 1 && (
				<fieldset disabled={busy} className="mt-2 space-y-2 border-0 p-0">
					<legend className="text-xs font-semibold">
						Which transaction is the opposite side?
					</legend>
					<div className="space-y-1">
						{actionable.peers.map((peerId) => (
							<label key={peerId} className="flex items-center gap-2 text-xs">
								<input
									type="radio"
									name={`transfer-peer-${actionable.finding.id}`}
									value={peerId}
									checked={peer === peerId}
									onChange={() => setSelectedPeer(peerId)}
								/>
								<span>{peerId}</span>
							</label>
						))}
					</div>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={busy || !peer}
						aria-label={`Link as transfer with ${peer}`}
						onClick={confirmPair}
					>
						{confirm.isPending ? "Linking…" : "Link as transfer"}
					</Button>
				</fieldset>
			)}
			{matcherDetail && (
				<details className="mt-1">
					<summary className="cursor-pointer text-xs text-muted-foreground">
						Matcher detail
					</summary>
					<p className="m-0 mt-1 text-xs text-muted-foreground">
						{matcherDetail}
					</p>
				</details>
			)}
			{inlineError && (
				<p role="alert" className={cn("mt-2 text-sm text-danger-text")}>
					{inlineError}
				</p>
			)}
		</div>
	);
}
