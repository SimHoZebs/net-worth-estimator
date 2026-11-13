import type { ReactNode } from "react";
import type { Account } from "../../domain/model.ts";
import { ACCOUNT_TYPE_LABELS } from "../../domain/accountKinds.ts";
import type { AccountKind } from "../../api/contracts.ts";
import { accountKindIcons } from "../AccountIcon.tsx";
import { OptionPicker } from "../OptionPicker.tsx";
import { dateLabel } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { Checkbox } from "../Field.tsx";
import { mergeStyles } from "../mergeStyles.ts";
import { PaymentTermsSection } from "./PaymentTermsSection.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";
import {
	transactionControlStyles,
	detailPropertyLabelClassName,
} from "./transactionDetailStyles.ts";

const accountPropertyRowClassName =
	"flex items-center gap-4 border-t border-line first:border-t-0";

function PropertyRow({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<div className={accountPropertyRowClassName}>
			{htmlFor ? (
				<label htmlFor={htmlFor} className={detailPropertyLabelClassName}>
					{label}
				</label>
			) : (
				<span className={detailPropertyLabelClassName}>{label}</span>
			)}
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				{children}
			</div>
		</div>
	);
}

function BankDetails({ account }: { account: Account }) {
	if (!account.institution) return null;
	const rows = [
		{ label: "Bank", value: account.institution },
		{ label: "Synced as", value: account.syncedName },
		{ label: "Currency", value: account.currency },
		{ label: "Last synced", value: dateLabel(account.observedOn, true) },
	];
	return (
		<dl className="m-0 grid gap-4 border-t border-line pt-4 text-sm">
			{rows
				.filter((row) => row.value)
				.map((row) => (
					<div key={row.label} className={accountPropertyRowClassName}>
						<dt className={detailPropertyLabelClassName}>{row.label}</dt>
						<dd className="m-0 min-w-0 flex-1 break-words font-medium text-ink">
							{row.value}
						</dd>
					</div>
				))}
		</dl>
	);
}

export function AccountDetails({
	account,
	edit,
	readOnly,
}: {
	account: Account;
	edit: AccountEdit;
	readOnly: boolean;
}) {
	const locked = readOnly || edit.saving;
	const { draft, formId } = edit;
	const kindOptions = (["cash", "investment", "property", "debt"] as const).map(
		(kind: AccountKind) => ({
			value: kind,
			label: ACCOUNT_TYPE_LABELS[kind],
			icon: accountKindIcons[kind],
		}),
	);
	return (
		<section aria-label="Account settings" className="grid gap-4">
			<OptionPicker
				label="Account type"
				labelClassName={detailPropertyLabelClassName}
				triggerId={`${formId}-kind`}
				value={draft.kind}
				valueLabel={ACCOUNT_TYPE_LABELS[draft.kind]}
				ValueIcon={accountKindIcons[draft.kind]}
				options={kindOptions}
				onSelect={(kind) =>
					edit.update(
						{
							kind:
								parseUnion(kind, [
									"cash",
									"investment",
									"property",
									"debt",
								] as const) ?? "cash",
						},
						"kind",
					)
				}
				disabled={edit.saving}
			/>
			{readOnly && (
				<p className="m-0 text-xs text-muted">
					Synced balances stay bank-owned; the type is yours to set.
				</p>
			)}
			<PropertyRow label="Included">
				<label
					htmlFor={`${formId}-enabled`}
					className="inline-flex min-w-0 items-center gap-2 text-sm"
				>
					<Checkbox
						form={formId}
						id={`${formId}-enabled`}
						aria-label="Include in net worth and projections"
						name="enabled"
						checked={draft.enabled}
						disabled={locked}
						onChange={(event) =>
							edit.update({ enabled: event.target.checked }, "enabled")
						}
					/>
					<span>Net worth and projections</span>
				</label>
			</PropertyRow>
			<PropertyRow label="Protected balance" htmlFor={`${formId}-protected`}>
				<span className="text-sm" aria-hidden="true">
					$
				</span>
				<input
					form={formId}
					id={`${formId}-protected`}
					aria-label="Protected balance in USD"
					name="minBalance"
					type="number"
					required
					min="0"
					max="10000000000"
					step="0.01"
					value={draft.minBalance}
					readOnly={locked}
					className={mergeStyles(
						transactionControlStyles({ shape: "inline" }),
						"w-16 min-w-0 flex-1 text-sm",
					)}
					onChange={(event) =>
						edit.update({ minBalance: event.target.value }, "protected")
					}
				/>
			</PropertyRow>
			<PropertyRow label="Ceiling">
				<label
					htmlFor={`${formId}-no-ceiling`}
					className="inline-flex items-center gap-2 text-sm"
				>
					<Checkbox
						form={formId}
						id={`${formId}-no-ceiling`}
						name="noCeiling"
						checked={draft.noCeiling}
						disabled={locked}
						onChange={(event) =>
							edit.update(
								{
									noCeiling: event.target.checked,
									...(!event.target.checked && draft.maxBalance === ""
										? { maxBalance: draft.minBalance }
										: {}),
								},
								"ceiling",
							)
						}
					/>
					No ceiling
				</label>
				{!draft.noCeiling && (
					<>
						<span className="text-sm" aria-hidden="true">
							$
						</span>
						<input
							form={formId}
							id={`${formId}-ceiling`}
							aria-label="Maximum balance in USD"
							name="maxBalance"
							type="number"
							required
							min="0"
							max="10000000000"
							step="0.01"
							value={draft.maxBalance}
							readOnly={locked}
							className={mergeStyles(
								transactionControlStyles({ shape: "inline" }),
								"w-16 min-w-0 flex-1 text-sm",
							)}
							onChange={(event) =>
								edit.update({ maxBalance: event.target.value }, "ceiling")
							}
						/>
					</>
				)}
			</PropertyRow>
			<BankDetails account={account} />
			{draft.kind === "debt" && (
				<PaymentTermsSection accountId={account.id} readOnly={locked} />
			)}
		</section>
	);
}
