import type { Account } from "../../domain/model.ts";
import {
	accountBalanceDisplayData,
	canChooseDisplayBasis,
	effectiveDisplayBasis,
} from "../../domain/accountDisplay.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import {
	dateLabel,
	exactMoney,
	isoDateFromEpochSeconds,
	money,
} from "../../domain/format.ts";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "@/components/ui/item.tsx";
import { persistAccountDisplayBasis } from "../../state/accountKind.ts";

export function LoanDetails({
	account,
	readOnly,
	onEdit,
}: {
	account: Account;
	readOnly: boolean;
	onEdit: (target: EditorTarget) => void;
}) {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const data = accountBalanceDisplayData(account);
	const basis = effectiveDisplayBasis(account);
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
				{account.components?.length ? <ItemSeparator /> : null}
				{data.entries.map((entry, index) => (
					<Fragment key={entry.label}>
						{index > 0 && <ItemSeparator />}
						<Item>
							<ItemContent className="max-w-36">
								<ItemTitle className="text-muted-foreground">
									{entry.label}
								</ItemTitle>
							</ItemContent>
							<ItemContent className="min-w-0 items-end">
								<span className="text-sm font-medium tabular-nums text-foreground">
									{money(entry.value)}
								</span>
							</ItemContent>
						</Item>
					</Fragment>
				))}
				{data.synced ? (
					<Fragment key="last-synced">
						<ItemSeparator />
						<Item>
							<ItemContent className="max-w-36">
								<ItemTitle className="text-muted-foreground">
									Last synced
								</ItemTitle>
							</ItemContent>
							<ItemContent className="min-w-0 items-end">
								<time
									dateTime={data.synced}
									className="text-sm font-medium text-foreground"
								>
									{dateLabel(data.synced, true)}
								</time>
							</ItemContent>
						</Item>
					</Fragment>
				) : null}
				<ItemSeparator />
				<Item>
					<ItemContent className="max-w-36">
						<label
							htmlFor={`loan-display-basis-${account.id}`}
							className="w-fit text-sm font-medium leading-snug text-muted-foreground"
						>
							Display value
						</label>
					</ItemContent>
					<ItemActions>
						<Select
							value={basis}
							disabled={readOnly || saving || !canChooseDisplayBasis(account)}
							onValueChange={(next) => {
								const displayBasis = next === "posted" ? "posted" : "available";
								if (displayBasis === basis || saving) return;
								setSaving(true);
								setError(null);
								void persistAccountDisplayBasis(
									{
										id: account.id,
										name: account.name,
										kind: account.kind,
										enabled: account.enabled,
										color: account.color,
									},
									displayBasis,
								).then((ok) => {
									setSaving(false);
									if (!ok)
										setError(
											"The display value could not be saved. Review the workspace notice and try again.",
										);
								});
							}}
						>
							<SelectTrigger
								id={`loan-display-basis-${account.id}`}
								aria-label="Display value"
								className="w-48"
							>
								<SelectValue>
									{(value: string | null) =>
										value === "posted" ? "Posted" : "Available"
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem
									value="available"
									disabled={!canChooseDisplayBasis(account)}
								>
									Available
								</SelectItem>
								<SelectItem value="posted">Posted</SelectItem>
							</SelectContent>
						</Select>
					</ItemActions>
				</Item>
			</ItemGroup>
			{error ? (
				<p role="alert" className="m-0 text-sm text-destructive">
					{error}
				</p>
			) : null}
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
