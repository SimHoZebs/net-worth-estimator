import { useState } from "react";
import { duplicateIdError } from "@/components/_draftHelpers";
import {
	FieldError,
	LabeledField,
	useSubmitError,
} from "@/components/fields/FieldKit";
import { Button } from "@/components/ui/Button";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import { ConfirmButton } from "../tables/primitives/Shells";

function emptyAccount(): Account {
	return {
		id: "",
		label: "",
		minBalance: NO_FLOOR,
		maxBalance: NO_CEILING,
		color: null,
		enabled: true,
	};
}

interface TemporaryAccountFormProps {
	accounts: Account[];
	reservedIds?: string[];
	onAdd: (account: Account) => void;
	onRemove: (id: string) => void;
}

export function TemporaryAccountForm({
	accounts,
	reservedIds = [],
	onAdd,
	onRemove,
}: TemporaryAccountFormProps) {
	const [adding, setAdding] = useState<Account | null>(null);
	const { error, errorId, formRef, fail, clear, propsFor } = useSubmitError();

	const updateAdding = (patch: Partial<Account>) => {
		if (error) clear();
		setAdding((current) => (current ? { ...current, ...patch } : current));
	};

	const suggestId = (label: string) =>
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "account";

	const commit = () => {
		if (!adding) return;
		const id = adding.id.trim() || suggestId(adding.label);
		const label = adding.label.trim();
		if (!label) {
			fail("Give the account a name.", "temporary-account-label");
			return;
		}
		const duplicateError = duplicateIdError(
			id,
			"Account",
			reservedIds,
			accounts.map((account) => account.id),
		);
		if (duplicateError) {
			fail(duplicateError, "temporary-account-id");
			return;
		}
		onAdd({ ...adding, id, label });
		setAdding(null);
		clear();
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="type-eyebrow">
					Accounts {accounts.length > 0 ? `(${accounts.length})` : ""}
				</span>
				{!adding ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="min-h-11"
						onClick={() => {
							setAdding(emptyAccount());
							clear();
						}}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div
					ref={formRef}
					className="space-y-2 rounded-2xl border border-border p-3"
				>
					<div className="grid gap-2 sm:grid-cols-2">
						<LabeledField
							label="ID"
							description="Unique ID — auto-filled from the name when left blank."
							id="temporary-account-id"
							labelClassName="type-body font-medium text-foreground"
							value={adding.id}
							onChange={(id) => updateAdding({ id })}
							placeholder="e.g. savings"
							{...propsFor("temporary-account-id")}
						/>
						<LabeledField
							label="Label"
							id="temporary-account-label"
							labelClassName="type-body font-medium text-foreground"
							value={adding.label}
							onChange={(label) =>
								updateAdding({
									label,
									...(adding.id.trim() ? null : { id: suggestId(label) }),
								})
							}
							placeholder="Savings"
							{...propsFor("temporary-account-label")}
						/>
					</div>
					{error ? <FieldError id={errorId}>{error}</FieldError> : null}
					<div className="sticky bottom-0 -mx-3 -mb-3 flex gap-2 border-t border-border/70 bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
						<Button
							type="button"
							size="sm"
							className="min-h-11"
							onClick={commit}
						>
							Add account
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="min-h-11"
							onClick={() => {
								setAdding(null);
								clear();
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
			{accounts.map((account) => (
				<div
					key={`tmp-acc-${account.id}`}
					className="flex items-center justify-between rounded-xl border border-tertiary-border bg-tertiary-subtle px-4 py-2"
				>
					<div className="flex items-center gap-2">
						<span
							className="inline-block h-2.5 w-2.5 rounded-full"
							style={{ backgroundColor: account.color ?? "GrayText" }}
						/>
						<span className="type-label text-tertiary-foreground">
							{account.label}
						</span>
						<span className="type-caption text-tertiary-foreground/80">
							{account.id}
						</span>
					</div>
					<ConfirmButton
						label={`Remove temporary account ${account.label}`}
						onConfirm={() => onRemove(account.id)}
						idleLabel="Remove"
						confirmLabel="Confirm remove"
						variant="ghost"
					/>
				</div>
			))}
		</div>
	);
}
