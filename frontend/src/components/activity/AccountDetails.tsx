import type { ReactNode } from "react";
import type { Account } from "../../domain/model.ts";
import { ACCOUNT_TYPE_LABELS } from "../../domain/accountKinds.ts";
import type { AccountKind } from "../../api/contracts.ts";
import { accountKindIcons } from "../AccountIcon.tsx";
import { dateLabel } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { PaymentTermsSection } from "./PaymentTermsSection.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

function PropertyField({
	label,
	htmlFor,
	description,
	children,
}: {
	label: string;
	htmlFor?: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<Field orientation="horizontal">
			<FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
				{children}
			</div>
			{description && <FieldDescription>{description}</FieldDescription>}
		</Field>
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
		<dl className="m-0 grid gap-4 border-t border-border pt-4 text-sm">
			{rows
				.filter((row) => row.value)
				.map((row) => (
					<div
						key={row.label}
						className="flex items-center gap-4 border-t border-border first:border-t-0"
					>
						<dt className="w-36 flex-none text-sm font-semibold text-muted-foreground">
							{row.label}
						</dt>
						<dd className="m-0 min-w-0 flex-1 break-words font-medium text-foreground">
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
	const KindIcon = accountKindIcons[draft.kind];
	return (
		<section aria-label="Account settings" className="grid gap-4">
			<PropertyField label="Account type" htmlFor={`${formId}-kind`}>
				<Select
					value={draft.kind}
					disabled={edit.saving}
					onValueChange={(kind) =>
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
				>
					<SelectTrigger id={`${formId}-kind`} aria-label="Account type">
						<KindIcon
							size={16}
							aria-hidden="true"
							className="flex-none text-muted-foreground"
						/>
						<SelectValue>
							{(value: string | null) =>
								(value !== null && ACCOUNT_TYPE_LABELS[value as AccountKind]) ||
								"Account type"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{kindOptions.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								<option.icon
									size={16}
									aria-hidden="true"
									className="flex-none text-muted-foreground"
								/>
								<span className="min-w-0 flex-1 truncate">{option.label}</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</PropertyField>
			{readOnly && (
				<p className="m-0 text-xs text-muted-foreground">
					Synced balances stay bank-owned; the type is yours to set.
				</p>
			)}
			<PropertyField label="Included">
				<span className="inline-flex min-w-0 items-center gap-2 text-sm">
					<Checkbox
						id={`${formId}-enabled`}
						aria-label="Include in net worth and projections"
						name="enabled"
						checked={draft.enabled}
						disabled={locked}
						onCheckedChange={(checked) =>
							edit.update({ enabled: checked === true }, "enabled")
						}
					/>
					<span>Net worth and projections</span>
				</span>
			</PropertyField>
			<PropertyField label="Protected balance" htmlFor={`${formId}-protected`}>
				<InputGroup className="w-48">
					<InputGroupAddon aria-hidden="true">$</InputGroupAddon>
					<InputGroupInput
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
						onChange={(event) =>
							edit.update({ minBalance: event.target.value }, "protected")
						}
					/>
				</InputGroup>
			</PropertyField>
			<PropertyField label="Ceiling">
				<span className="inline-flex items-center gap-2 text-sm">
					<Checkbox
						id={`${formId}-no-ceiling`}
						aria-label="No ceiling"
						name="noCeiling"
						checked={draft.noCeiling}
						disabled={locked}
						onCheckedChange={(checked) =>
							edit.update(
								{
									noCeiling: checked === true,
									...(!checked && draft.maxBalance === ""
										? { maxBalance: draft.minBalance }
										: {}),
								},
								"ceiling",
							)
						}
					/>
					<span>No ceiling</span>
				</span>
				{!draft.noCeiling && (
					<InputGroup className="w-48">
						<InputGroupAddon aria-hidden="true">$</InputGroupAddon>
						<InputGroupInput
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
							onChange={(event) =>
								edit.update({ maxBalance: event.target.value }, "ceiling")
							}
						/>
					</InputGroup>
				)}
			</PropertyField>
			<BankDetails account={account} />
			{draft.kind === "debt" && (
				<PaymentTermsSection accountId={account.id} readOnly={locked} />
			)}
		</section>
	);
}
