import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import type { Transaction } from "../../domain/model.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { useTransferLinks } from "../../state/analyses.ts";
import { useTransferPeers } from "./useTransferPeers.ts";

const linkState = vi.hoisted(() => ({
	data: undefined as { links: TransferLink[] } | undefined,
}));

vi.mock("../../state/analyses.ts", () => ({
	useTransferLinks: vi.fn(() => ({ data: linkState.data })),
}));

function transaction(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		kind: "transaction",
		fromId: "checking",
		toId: null,
		startDate: "2026-11-20",
		...overrides,
	};
}

const accounts = [
	{ id: "checking", name: "Checking" },
	{ id: "savings", name: "Savings" },
];

beforeEach(() => {
	linkState.data = undefined;
	vi.mocked(useTransferLinks).mockClear();
});

describe("useTransferPeers", () => {
	it("owns one link subscription and exposes loading, membership, and peers", () => {
		const rows = [
			transaction("spotify"),
			transaction("payment", { toId: "savings" }),
			transaction("card-leg", { fromId: null, toId: "checking" }),
		];
		const { result, rerender } = renderHook(() =>
			useTransferPeers(rows, accounts),
		);

		expect(useTransferLinks).toHaveBeenCalledOnce();
		expect(result.current).toEqual({
			peersById: new Map(),
			linkedIds: new Set(),
			loaded: false,
		});

		linkState.data = {
			links: [
				{ legA: "payment", legB: "card-leg" } as TransferLink,
				{ legA: "spotify", legB: "missing" } as TransferLink,
			],
		};
		rerender();

		expect(useTransferLinks).toHaveBeenCalledTimes(2);
		expect(result.current.loaded).toBe(true);
		expect(result.current.linkedIds).toEqual(
			new Set(["payment", "card-leg", "spotify"]),
		);
		expect(result.current.peersById.get("payment")).toEqual({
			peerId: "card-leg",
			peerName: "card-leg",
			accountName: "Checking",
		});
		expect(result.current.peersById.get("spotify")).toEqual({
			peerId: "missing",
			peerName: null,
			accountName: null,
		});
	});
});
