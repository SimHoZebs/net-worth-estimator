import { Info } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import { visibleAccounts, type Account } from "../../domain/model.ts";
import type { CurrentPosition } from "../../api/position.ts";
import { AccountDot } from "../AccountIcon.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Item, ItemContent, ItemGroup } from "@/components/ui/item.tsx";
import { cn } from "@/lib/utils.ts";

export function PositionEvidence({
	accounts,
	position,
	onClose,
}: {
	accounts: Account[];
	position: CurrentPosition;
	onClose: () => void;
}) {
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted">
						Current position
					</p>
					<DialogTitle>The basis of your net worth</DialogTitle>
				</DialogHeader>
				<div className="type-value mb-2 text-4xl leading-[1.2] font-medium tracking-tight">
					{money(position.netWorth)}
				</div>
				<p className="text-muted">
					Assets minus debts · as of {dateLabel(position.asOfDate, true)}
				</p>
				<ItemGroup className="my-5 gap-0">
					{visibleAccounts(accounts)
						.filter((account) => account.enabled)
						.map((account) => {
							const positionAccount = position.accounts.find(
								(item) => item.accountId === account.id,
							);
							const balance = positionAccount?.balance;
							return (
								<Item
									key={account.id}
									className="justify-between gap-5 rounded-none border-x-0 border-t-0 border-b border-line px-0 py-3"
								>
									<span className="text-muted">
										<span className="inline-flex items-center gap-2">
											<AccountDot color={account.color} />
											{account.name}
										</span>
										<small className="mt-1 block text-xs">
											{dateLabel(account.observedOn, true)}
										</small>
									</span>
									<ItemContent className="flex-none flex-row items-center justify-end gap-2 text-right">
										{balance === undefined ? "Unavailable" : money(balance)}
									</ItemContent>
								</Item>
							);
						})}
				</ItemGroup>
				<Alert
					role="note"
					className={cn(
						"border-success-border bg-success-bg text-success-text",
						"my-4",
					)}
				>
					<Info size={18} aria-hidden="true" />
					<AlertDescription className="text-success-text">
						Older values carry forward unchanged.
					</AlertDescription>
				</Alert>
			</DialogContent>
		</Dialog>
	);
}
