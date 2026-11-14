import { ArrowUpRight } from "lucide-react";
import { AccountIcon } from "../AccountIcon.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card.tsx";
import { money } from "../../domain/format.ts";
import type { AccountCardModel } from "../../domain/accountCards.ts";

export function AccountCard({
	card,
	onOpen,
}: {
	card: AccountCardModel;
	onOpen: (card: AccountCardModel) => void;
}) {
	const open = () => onOpen(card);
	return (
		<Card className="relative min-h-55">
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<AccountIcon account={card.account} />
					<span className="truncate">{card.name}</span>
				</CardTitle>
				<CardDescription>
					{card.institution}
					{card.last4 ? ` ···· ${card.last4}` : ""}
				</CardDescription>
				<CardAction>
					{/* Stretched hit area: the overlay must never become a
					positioned containing block on :active (the preset press
					shift would collapse it and swallow card-body clicks), so
					neutralize the press translation on this action only. */}
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`View details for ${card.name}`}
						onClick={open}
						className="after:absolute after:inset-0 active:translate-none!"
					>
						<ArrowUpRight
							size={16}
							aria-hidden="true"
							className="text-muted-foreground"
						/>
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div>
					<span className="type-value block text-2xl font-medium tracking-tight tabular-nums">
						{money(card.balance)}
					</span>
					<span className="mt-1 block text-xs text-muted-foreground">
						{card.balanceLabel}
					</span>
				</div>
				<span className="flex flex-wrap gap-2">
					{card.roles.map((role) => (
						<Badge key={role} variant="secondary">
							{role}
						</Badge>
					))}
				</span>
			</CardContent>
		</Card>
	);
}
