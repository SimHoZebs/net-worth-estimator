import type { Account } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import {
	dateLabel,
	exactMoney,
	isoDateFromEpochSeconds,
} from "../../domain/format.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@/components/ui/item.tsx";
import { Card, CardContent, CardDescription } from "@/components/ui/card.tsx";

export function LoanDetails({
	account,
	readOnly,
	onEdit,
}: {
	account: Account;
	readOnly: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	return (
		<section className="flex flex-col gap-5">
			<Card size="sm">
				<CardContent>
					<CardDescription>
						Payments cover accrued interest first, then principal. Interest
						charges use principal only.
					</CardDescription>
				</CardContent>
			</Card>
			<ItemGroup>
				{account.components?.map((c) => (
					<Item key={c.accountId} variant="outline" size="sm">
						<ItemContent>
							<ItemTitle className="capitalize">
								{c.role === "interest" ? "Accrued interest" : c.role}
							</ItemTitle>
							<p className="m-0 mt-1 text-xl font-medium tabular-nums">
								{exactMoney(Math.abs(c.balance))}
							</p>
							{c.observedAt !== null && c.observedBalance !== null && (
								<p className="m-0 mt-1 text-xs text-muted-foreground">
									Recorded {exactMoney(Math.abs(c.observedBalance))} on{" "}
									{dateLabel(isoDateFromEpochSeconds(c.observedAt), true)}
								</p>
							)}
						</ItemContent>
					</Item>
				))}
			</ItemGroup>
			<Button
				type="button"
				disabled={readOnly || account.readOnly}
				onClick={() => onEdit({ kind: "account", item: account })}
			>
				Edit debt and payment terms
			</Button>
		</section>
	);
}
