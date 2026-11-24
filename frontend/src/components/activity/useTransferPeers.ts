import { useMemo } from "react";
import type { Account, Transaction } from "../../domain/model.ts";
import { useTransferLinks } from "../../state/analyses.ts";
import { transferLinkForEdge } from "../../pages/flows/TransferMatchNote.tsx";
import {
	resolveTransferPeer,
	type TransferPeerSummary,
} from "./TransferLinkSection.tsx";

/** Resolve every visible leg from the shared cached transfer-link query. */
export function useTransferPeers(
	transactions: Transaction[],
	accounts: Account[],
): Map<string, TransferPeerSummary> {
	const linksQuery = useTransferLinks();
	return useMemo(() => {
		const links = linksQuery.data?.links ?? [];
		const resolved = new Map<string, TransferPeerSummary>();
		for (const row of transactions) {
			const peer = resolveTransferPeer({
				transactionId: row.id,
				link: transferLinkForEdge(links, [row.id]),
				transactions,
				accounts,
			});
			if (peer) resolved.set(row.id, peer);
		}
		return resolved;
	}, [linksQuery.data?.links, transactions, accounts]);
}
