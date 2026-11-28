import { useMemo } from "react";
import type { Account, Transaction } from "../../domain/model.ts";
import { useTransferLinks } from "../../state/analyses.ts";
import { transferLinkForEdge } from "../../pages/flows/TransferMatchNote.tsx";
import {
	resolveTransferPeer,
	type TransferPeerSummary,
} from "./TransferLinkSection.tsx";

export interface TransferListState {
	peersById: Map<string, TransferPeerSummary>;
	linkedIds: Set<string>;
	loaded: boolean;
}

/** Resolve transfer display state once from the shared cached link query. */
export function useTransferPeers(
	transactions: Transaction[],
	accounts: Pick<Account, "id" | "name">[],
): TransferListState {
	const linksQuery = useTransferLinks();
	return useMemo(() => {
		const links = linksQuery.data?.links ?? [];
		const peersById = new Map<string, TransferPeerSummary>();
		const linkedIds = new Set<string>();
		for (const row of transactions) {
			const link = transferLinkForEdge(links, [row.id]);
			if (!link) continue;
			linkedIds.add(row.id);
			const peer = resolveTransferPeer({
				transactionId: row.id,
				link,
				transactions,
				accounts,
			});
			if (peer) peersById.set(row.id, peer);
		}
		return {
			peersById,
			linkedIds,
			loaded: linksQuery.data !== undefined,
		};
	}, [linksQuery.data, transactions, accounts]);
}
