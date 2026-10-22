import { useMemo, useState } from "react";
import { toAccountCards } from "../../domain/accountCards.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/result.ts";
import { AccountCard } from "./AccountCard.tsx";
import { AccountDetailsModal } from "./AccountDetailsModal.tsx";
import type { AccountCardModel } from "../../domain/accountCards.ts";

export function AccountCardGrid({
	plan,
	projection,
	query,
}: {
	plan: Plan;
	projection: Projection | null;
	query: string;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const cards = useMemo(
		() => toAccountCards({ plan, projection }),
		[plan, projection],
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
					plan={plan}
					projection={projection}
					onClose={() => setSelectedId(null)}
				/>
			)}
		</>
	);
}
