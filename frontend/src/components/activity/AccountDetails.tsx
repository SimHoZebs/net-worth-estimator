import { Fragment, type ReactNode } from "react";
import type { Account } from "../../domain/model.ts";
import {
	accountBalanceDisplayData,
	canChooseDisplayBasis,
	effectiveDisplayBasis,
} from "../../domain/accountDisplay.ts";
import { ACCOUNT_TYPE_LABELS } from "../../domain/accountKinds.ts";
import type { AccountKind } from "../../api/contracts.ts";
import { accountKindIcons } from "../AccountIcon.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import { parseUnion } from "../../domain/guards.ts";
import { Checkbox } from "@/components/ui/checkbox.tsx";
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
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemSeparator,
	ItemTitle,
} from "@/components/ui/item.tsx";
import { PaymentTermsSection } from "./PaymentTermsSection.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

/** One settings row: a label in the item slot and its control in the actions slot. */
function SettingRow({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	return (
		<Item>
			<ItemContent className="max-w-36">
				{htmlFor ? (
					<label
						htmlFor={htmlFor}
						className="w-fit text-sm font-medium leading-snug text-muted-foreground"
					>
						{label}
					</label>
				) : (
					<ItemTitle className="text-muted-foreground">{label}</ItemTitle>
				)}
			</ItemContent>
			<ItemActions>{children}</ItemActions>
		</Item>
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
	// The display basis is owner config, not bank evidence, so it stays
	// editable on synced accounts. A workspace-level read-only view still
	// locks it: readOnly without account.readOnly means the session, not
	// the bank, forbids writes.
	const basisLocked = edit.saving || (readOnly && !account.readOnly);
	const { draft, formId } = edit;
	const data = accountBalanceDisplayData(account);
	// With both figures present the selector follows the owner's in-progress
	// choice. With only one figure there is no choice, so the effective basis
	// drives the displayed value without writing it back to the draft.
	const basis = canChooseDisplayBasis(account)
		? (draft.displayBasis ?? "available")
		: effectiveDisplayBasis(account);
	const kindOptions = (["cash", "investment", "property", "debt"] as const).map(
		(kind: AccountKind) => ({
			value: kind,
			label: ACCOUNT_TYPE_LABELS[kind],
			icon: accountKindIcons[kind],
		}),
	);
	const KindIcon = accountKindIcons[draft.kind];

	const rows: { key: string; node: ReactNode }[] = [];
	rows.push({
		key: "kind",
		node: (
			<SettingRow label="Account type" htmlFor={`${formId}-kind`}>
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
			</SettingRow>
		),
	});
	rows.push({
		key: "enabled",
		node: (
			<SettingRow label="Included">
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
			</SettingRow>
		),
	});
	rows.push({
		key: "protected",
		node: (
			<SettingRow label="Protected balance" htmlFor={`${formId}-protected`}>
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
			</SettingRow>
		),
	});
	rows.push({
		key: "ceiling",
		node: (
			<SettingRow label="Ceiling">
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
			</SettingRow>
		),
	});
	if (account.institution) {
		const bankRows = [
			{ label: "Bank", value: account.institution },
			{ label: "Synced as", value: account.syncedName },
			{ label: "Currency", value: account.currency },
		];
		for (const row of bankRows.filter((entry) => entry.value)) {
			rows.push({
				key: row.label,
				node: (
					<Item>
						<ItemContent className="max-w-36">
							<ItemTitle className="text-muted-foreground">
								{row.label}
							</ItemTitle>
						</ItemContent>
						<ItemContent className="min-w-0 items-end">
							<span className="break-words text-sm font-medium text-foreground">
								{row.value}
							</span>
						</ItemContent>
					</Item>
				),
			});
		}
	}
	for (const entry of data.entries) {
		rows.push({
			key: entry.label,
			node: (
				<SettingRow label={entry.label}>
					<span
						className={
							entry.emphasized
								? "text-lg font-semibold tabular-nums text-foreground"
								: "text-sm tabular-nums text-muted-foreground"
						}
					>
						{money(entry.value)}
					</span>
				</SettingRow>
			),
		});
	}
	if (data.synced) {
		rows.push({
			key: "last-synced",
			node: (
				<SettingRow label="Last synced">
					<time
						dateTime={data.synced}
						className="text-sm font-medium text-foreground"
					>
						{dateLabel(data.synced, true)}
					</time>
				</SettingRow>
			),
		});
	}
	rows.push({
		key: "display",
		node: (
			<SettingRow label="Display value" htmlFor={`${formId}-display-basis`}>
				<Select
					value={basis}
					disabled={basisLocked || !canChooseDisplayBasis(account)}
					onValueChange={(basis) =>
						edit.update(
							{
								displayBasis:
									parseUnion(basis, ["available", "posted"] as const) ??
									"available",
							},
							"display",
						)
					}
				>
					<SelectTrigger
						id={`${formId}-display-basis`}
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
			</SettingRow>
		),
	});
	if (draft.kind === "debt") {
		rows.push({
			key: "payment-terms",
			node: (
				<Item>
					<ItemContent className="min-w-0">
						<PaymentTermsSection accountId={account.id} readOnly={locked} />
					</ItemContent>
				</Item>
			),
		});
	}

	return (
		<section aria-label="Account settings">
			<ItemGroup className="gap-0">
				{rows.map(({ key, node }, index) => (
					<Fragment key={key}>
						{index > 0 && <ItemSeparator />}
						{node}
					</Fragment>
				))}
			</ItemGroup>
		</section>
	);
}
