import { Scale } from "lucide-react";
import { useState } from "react";
import type { BalanceAdjustment } from "@/api/generated/model/balanceAdjustment.ts";
import { dateLabel, exactMoney } from "../../domain/format.ts";
import { TransactionItemRow } from "./TransactionItem.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@/components/ui/item.tsx";

export function BalanceAdjustmentRow({
	adjustment,
}: {
	adjustment: BalanceAdjustment;
}) {
	const [open, setOpen] = useState(false);
	const date = new Date(adjustment.observedAt * 1000).toISOString();
	const rows = [
		{
			label: "Recorded at (UTC)",
			value: (
				<time dateTime={date}>
					{date.replace("T", " ").replace(".000Z", " UTC")}
				</time>
			),
		},
		{
			label: "Previous balance",
			value: exactMoney(adjustment.previousBalance),
		},
		{ label: "New balance", value: exactMoney(adjustment.balance) },
		{ label: "Adjustment", value: exactMoney(adjustment.adjustment) },
		{
			label: "Source",
			value:
				adjustment.source === "user" || adjustment.source === ""
					? "Manual adjustment"
					: "Bank balance",
		},
	];
	return (
		<>
			<TransactionItemRow
				date={<time dateTime={date}>{dateLabel(date, true)}</time>}
				icon={<Scale size={16} aria-hidden="true" />}
				tone="transfer"
				title="Balance adjustment"
				amount={
					<strong className="text-sm tabular-nums">
						{adjustment.adjustment > 0
							? "+"
							: adjustment.adjustment < 0
								? "−"
								: ""}
						{exactMoney(Math.abs(adjustment.adjustment))}
					</strong>
				}
				actionLabel={`View balance adjustment on ${dateLabel(date, true)}`}
				onSelect={() => setOpen(true)}
				slots={{
					mobile: dateLabel(date, true),
				}}
			/>
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!next) setOpen(false);
				}}
			>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Balance adjustment</DialogTitle>
						<DialogDescription className="sr-only">
							Details of the balance adjustment recorded at{" "}
							{dateLabel(date, true)}
						</DialogDescription>
					</DialogHeader>
					<ItemGroup>
						{rows.map((row) => (
							<Item key={row.label} variant="outline" size="sm">
								<ItemContent>
									<ItemTitle>{row.label}</ItemTitle>
									<ItemDescription>{row.value}</ItemDescription>
								</ItemContent>
							</Item>
						))}
					</ItemGroup>
					<p className="text-sm text-muted-foreground">
						This entry reconciles the account balance. It does not count as
						income or spending.
					</p>
				</DialogContent>
			</Dialog>
		</>
	);
}
