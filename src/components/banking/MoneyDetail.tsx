import { useState } from "react";
import { PostingCalculationDetails } from "@/components/dashboard/tables/PostingAmount";
import { DateText } from "@/components/dashboard/tables/primitives/formatting";
import { TransactionRoute } from "@/components/dashboard/tables/TransactionPresentation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { currency, formatFrequency, pct } from "@/lib/format";
import type { Account, Posting } from "@/lib/projection";
import { describePostingAmount, getExpression } from "@/lib/projection";
import { MoneyAmountText, MoneyAvatar } from "./MoneyRow";
import { directionLabel, moneyDirection } from "./money";

export function MoneyDetail({
	posting,
	accounts,
	onClose,
	onEdit,
	onExclude,
	onRestore,
	onDelete,
	excluded,
}: {
	posting: Posting;
	accounts: Account[];
	onClose: () => void;
	onEdit: () => void;
	onExclude: () => void;
	onRestore: () => void;
	onDelete: () => void;
	excluded: boolean;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const direction = moneyDirection(posting);
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const avatarColor =
		(posting.sourceAccountId
			? accountById.get(posting.sourceAccountId)?.color
			: null) ??
		(posting.destinations?.[0]
			? accountById.get(posting.destinations[0])?.color
			: null);
	const assumptions = [
		posting.annualRate ? `${pct.format(posting.annualRate)} rate` : null,
		posting.annualGrowthRate
			? `${pct.format(posting.annualGrowthRate)} growth`
			: null,
		posting.volatility ? `${pct.format(posting.volatility)} volatility` : null,
		posting.annualCap !== null
			? `${currency.format(posting.annualCap)} cap`
			: null,
	].filter(Boolean);

	return (
		<Dialog
			ariaLabelledby="money-detail-title"
			onClose={onClose}
			className="max-w-md rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div className="space-y-4 px-6 py-6">
				<div className="flex items-center gap-3">
					<MoneyAvatar
						label={posting.label}
						color={avatarColor}
						direction={direction}
					/>
					<div className="min-w-0 flex-1">
						<h2 id="money-detail-title" className="truncate type-title text-lg">
							{posting.label}
						</h2>
						<p className="type-caption">{directionLabel(direction)}</p>
					</div>
					<div className="type-title text-xl">
						<MoneyAmountText posting={posting} />
					</div>
				</div>

				<dl className="space-y-2 rounded-2xl bg-surface/60 p-4 type-body">
					<div className="flex justify-between gap-3">
						<dt className="type-caption">Route</dt>
						<dd className="text-right">
							<TransactionRoute posting={posting} accountById={accountById} />
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="type-caption">Schedule</dt>
						<dd className="text-right">
							{formatFrequency(posting.frequency)} from{" "}
							<DateText value={posting.startDate} />
							{posting.endDate ? (
								<>
									{" through "}
									<DateText value={posting.endDate} />
								</>
							) : null}
						</dd>
					</div>
					<div className="flex justify-between gap-3">
						<dt className="type-caption">Amount</dt>
						<dd className="break-all text-right type-code">
							{describePostingAmount(posting)}
						</dd>
					</div>
					{assumptions.length > 0 ? (
						<div className="flex justify-between gap-3">
							<dt className="type-caption">Assumptions</dt>
							<dd className="text-right">{assumptions.join(" · ")}</dd>
						</div>
					) : null}
				</dl>

				{getExpression(posting) === null ? (
					<PostingCalculationDetails posting={posting} />
				) : null}

				<details className="rounded-2xl border border-border/70 px-4 py-3">
					<summary className="cursor-pointer type-caption">Details</summary>
					<p className="mt-2 break-all type-code">
						{posting.id} · priority {posting.priority}
					</p>
				</details>

				<div className="flex flex-wrap justify-end gap-2">
					{excluded ? (
						<Button
							type="button"
							variant="secondary"
							size="sm"
							onClick={onRestore}
						>
							Restore
						</Button>
					) : (
						<Button type="button" variant="ghost" size="sm" onClick={onExclude}>
							Exclude
						</Button>
					)}
					<Button type="button" variant="secondary" size="sm" onClick={onEdit}>
						Edit
					</Button>
					{confirmingDelete ? (
						<Button
							type="button"
							variant="destructive"
							size="sm"
							onClick={onDelete}
						>
							Confirm delete
						</Button>
					) : (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setConfirmingDelete(true)}
						>
							Delete
						</Button>
					)}
				</div>
			</div>
		</Dialog>
	);
}
