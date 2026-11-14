import type { Account } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import {
	dateLabel,
	exactMoney,
	isoDateFromEpochSeconds,
} from "../../domain/format.ts";
import { Fragment } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "@/components/ui/item.tsx";

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
			<p className="text-sm leading-relaxed text-muted-foreground">
				Payments cover accrued interest first, then principal. Interest charges
				use principal only.
			</p>
			<ItemGroup className="gap-0">
				{account.components?.map((c, index) => (
					<Fragment key={c.accountId}>
						{index > 0 && <ItemSeparator />}
						<Item variant="outline" size="sm">
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
					</Fragment>
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
