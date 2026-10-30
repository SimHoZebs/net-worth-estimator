import { Info } from "lucide-react";
import { dateLabel, money } from "../../domain/format.ts";
import { visibleAccounts, type Account } from "../../domain/model.ts";
import type { CurrentPosition } from "../../api/position.ts";
import { AccountDot } from "../AccountIcon.tsx";
import { DetailList, DetailRow } from "../DetailRow.tsx";
import { Notice } from "../Notice.tsx";
import { Modal } from "../Modal.tsx";

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
		<Modal
			title="The basis of your net worth"
			eyebrow="Current position"
			onClose={onClose}
		>
			<div className="type-value mb-2 text-4xl leading-[1.2] font-medium tracking-tight">
				{money(position.netWorth)}
			</div>
			<p className="text-muted">
				Assets minus debts · as of {dateLabel(position.asOfDate, true)}
			</p>
			<DetailList>
				{visibleAccounts(accounts)
					.filter((account) => account.enabled)
					.map((account) => {
						const balance = position.accounts.find(
							(item) => item.accountId === account.id,
						)?.balance;
						return (
							<DetailRow
								key={account.id}
								label={
									<>
										<span className="inline-flex items-center gap-2">
											<AccountDot color={account.color} />
											{account.name}
										</span>
										<small className="mt-1 block text-xs">
											{dateLabel(account.observedOn, true)}
										</small>
									</>
								}
							>
								{balance === undefined ? "Unavailable" : money(balance)}
							</DetailRow>
						);
					})}
			</DetailList>
			<Notice tone="info" className="my-4">
				<Info size={18} aria-hidden="true" />
				<span>Older values carry forward unchanged.</span>
			</Notice>
		</Modal>
	);
}
