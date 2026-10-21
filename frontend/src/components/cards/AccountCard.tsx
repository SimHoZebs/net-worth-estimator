import { ArrowUpRight } from "lucide-react";
import { AccountIcon } from "../AccountIcon.tsx";
import { Badge } from "../ui.tsx";
import { money } from "../../domain/format.ts";
import type { AccountCardModel } from "../../domain/accountCards.ts";
import "./account-cards.css";

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
			className="account-card"
			onClick={() => onOpen(card)}
			aria-label={`View details for ${card.name}`}
		>
			<span className="account-card-top">
				<AccountIcon account={card.account} />
				<ArrowUpRight size={16} aria-hidden="true" color="var(--muted)" />
			</span>
			<span>
				<span className="account-card-name">{card.name}</span>
				<br />
				<span className="account-card-sub">
					{card.institution}
					{card.last4 ? ` ···· ${card.last4}` : ""}
				</span>
			</span>
			<span>
				<span className="account-card-balance type-value">
					{money(card.balance)}
				</span>
				<br />
				<span className="account-card-label">{card.balanceLabel}</span>
			</span>
			<span className="account-card-badges">
				{card.roles.map((role) => (
					<Badge key={role} tone="neutral">
						{role}
					</Badge>
				))}
			</span>
			<span className="account-card-foot">
				<span className="account-card-summary">{card.summary}</span>
				<span aria-hidden="true">›</span>
			</span>
		</button>
	);
}
