import { useMemo } from "react";
import { toAccountCards } from "../../domain/accountCards.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";
import { AccountCard } from "./AccountCard.tsx";
import { AccountDetailsModal } from "./AccountDetailsModal.tsx";
import { useSelectedId } from "../entrySelection.ts";
import type { AccountCardModel } from "../../domain/accountCards.ts";

export function AccountCardGrid({
	accounts,
	transactions,
	startDate,
	readOnly,
	projection,
	query,
}: {
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
	readOnly: boolean;
	projection: Projection | null;
	query: string;
}) {
	const [selectedId, setSelectedId] = useSelectedId(accounts);
	const cards = useMemo(
		() => toAccountCards({ accounts, projection }),
		[accounts, projection],
	);
	const needle = query.trim().toLowerCase();
	const shown = needle
		? cards.filter((card) =>
				`${card.name} ${card.institution} ${card.kind}`
					.toLowerCase()
					.includes(needle),
			)
		: cards;
	const selected: AccountCardModel | null =
		shown.find((card) => card.id === selectedId) ??
		cards.find((card) => card.id === selectedId) ??
		null;
	return (
		<>
			<div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--container-3xs)),1fr))] gap-4">
				{shown.map((card) => (
					<AccountCard
						key={card.id}
						card={card}
						onOpen={(next) => setSelectedId(next.id)}
					/>
				))}
			</div>
			{selected && (
				<AccountDetailsModal
					card={selected}
					accounts={accounts}
					transactions={transactions}
					startDate={startDate}
					readOnly={readOnly}
					projection={projection}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}
