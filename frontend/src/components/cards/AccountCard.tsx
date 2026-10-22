import { ArrowUpRight } from "lucide-react";
import { AccountIcon } from "../AccountIcon.tsx";
import { Badge } from "../ui.tsx";
import { money } from "../../domain/format.ts";
import type { AccountCardModel } from "../../domain/accountCards.ts";

export function AccountCard({
	card,
	onOpen,
}: {
	card: AccountCardModel;
	onOpen: (card: AccountCardModel) => void;
}) {
	return (
		<button
			type="button"
			className="flex min-h-55 cursor-pointer flex-col gap-3 rounded-surface border border-line bg-surface p-4 text-left text-inherit transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-md"
			onClick={() => onOpen(card)}
			aria-label={`View details for ${card.name}`}
		>
			<span className="flex items-center justify-between">
				<AccountIcon account={card.account} />
				<ArrowUpRight size={16} aria-hidden="true" className="text-muted" />
			</span>
			<span>
				<span className="truncate text-sm font-semibold">{card.name}</span>
				<br />
				<span className="text-xs text-muted">
					{card.institution}
					{card.last4 ? ` ···· ${card.last4}` : ""}
				</span>
			</span>
			<span>
				<span className="type-value text-2xl font-medium tracking-[-0.8px] tabular-nums">
					{money(card.balance)}
				</span>
				<br />
				<span className="text-xs text-muted">{card.balanceLabel}</span>
			</span>
			<span className="flex flex-wrap gap-2">
				{card.roles.map((role) => (
					<Badge key={role} tone="neutral">
						{role}
					</Badge>
				))}
			</span>
			<span className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
				<span className="truncate">{card.summary}</span>
				<span aria-hidden="true">›</span>
			</span>
		</button>
	);
}
