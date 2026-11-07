import type { Account } from "../../domain/model.ts";
import type { EditorTarget } from "../../domain/accountEdits.ts";
import {
	dateLabel,
	exactMoney,
	isoDateFromEpochSeconds,
} from "../../domain/format.ts";
import { Button } from "../Button.tsx";

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
			<p className="text-sm text-muted">
				Payments cover accrued interest first, then principal. Interest charges
				use principal only.
			</p>
			<dl className="m-0 grid grid-cols-2 gap-4">
				{account.components?.map((c) => (
					<div
						key={c.accountId}
						className="rounded-control border border-line p-4"
					>
						<dt className="text-sm capitalize text-muted">
							{c.role === "interest" ? "Accrued interest" : c.role}
						</dt>
						<dd className="type-value m-0 mt-2 text-xl">
							{exactMoney(Math.abs(c.balance))}
						</dd>
						{c.observedAt !== null && c.observedBalance !== null && (
							<dd className="m-0 mt-2 text-xs text-muted">
								Recorded {exactMoney(Math.abs(c.observedBalance))} on{" "}
								{dateLabel(isoDateFromEpochSeconds(c.observedAt), true)}
							</dd>
						)}
					</div>
				))}
			</dl>
			<Button
				type="button"
				disabled={readOnly || account.readOnly}
				onClick={() => onEdit({ kind: "account", item: account })}
			>
				Edit loan and payment terms
			</Button>
		</section>
	);
}
