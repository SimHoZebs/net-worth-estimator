import { useState } from "react";
import { duplicateIdError } from "@/components/_draftHelpers";
import { FIELD_ERROR_CLASS, LabeledField } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

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
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		if (!adding?.id.trim() || !adding.label.trim()) return;
		const id = adding.id.trim();
		const duplicateError = duplicateIdError(
			id,
			"Account",
			reservedIds,
			accounts.map((account) => account.id),
		);
		if (duplicateError) {
			setError(duplicateError);
			return;
		}
		onAdd({ ...adding, id, label: adding.label.trim() });
		setAdding(null);
		setError(null);
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
						onClick={() => {
							setAdding(emptyAccount());
							setError(null);
						}}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div className="space-y-2 rounded-2xl border border-border p-3">
					<div className="grid gap-2 sm:grid-cols-2">
						<LabeledField
							label="ID"
							id="temporary-account-id"
							value={adding.id}
							onChange={(id) => setAdding({ ...adding, id })}
							placeholder="e.g. savings"
						/>
						<LabeledField
							label="Label"
							id="temporary-account-label"
							value={adding.label}
							onChange={(label) => setAdding({ ...adding, label })}
							placeholder="Savings"
						/>
					</div>
					{error ? <div className={FIELD_ERROR_CLASS}>{error}</div> : null}
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={commit}>
							Add account
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setAdding(null);
								setError(null);
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
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onRemove(account.id)}
					>
						Remove
					</Button>
				</div>
			))}
		</div>
	);
}
