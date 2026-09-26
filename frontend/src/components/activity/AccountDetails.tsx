import { Pencil } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import { DetailRow } from "../DetailRow.tsx";

export function AccountDetails({
	account,
	endingBalance,
	onEdit,
}: {
	account: Account;
	endingBalance: number;
	onEdit: () => void;
}) {
	return (
		<>
			<dl className="detail-list">
				<DetailRow label="Source">{account.source}</DetailRow>
				<DetailRow label="Balance date">
					{dateLabel(account.observedOn, true)}
				</DetailRow>
				<DetailRow label="Protected from spending">
					{money(account.floor)}
				</DetailRow>
				<DetailRow label="Incoming balance ceiling">
					{account.ceiling === null ? "No ceiling" : money(account.ceiling)}
				</DetailRow>
				<DetailRow label="Base case at horizon">
					{money(endingBalance)}
				</DetailRow>
				<DetailRow label="Record access">
					{!account.enabled
						? "Excluded from net worth and projections"
						: account.readOnly
							? "Read-only source record"
							: "Editable in a temporary version"}
				</DetailRow>
			</dl>
			<div className="modal-actions">
				<button type="button" className="button primary" onClick={onEdit}>
					<Pencil size={16} />
					{account.readOnly ? "Inspect source record" : "Edit account"}
				</button>
			</div>
		</>
	);
}
