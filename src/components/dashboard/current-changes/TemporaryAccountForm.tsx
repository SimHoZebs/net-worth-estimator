import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
	onAdd: (account: Account) => void;
	onRemove: (id: string) => void;
}

export function TemporaryAccountForm({
	accounts,
	onAdd,
	onRemove,
}: TemporaryAccountFormProps) {
	const [adding, setAdding] = useState<Account | null>(null);

	const commit = () => {
		if (adding?.id.trim() && adding.label.trim()) {
			onAdd(adding);
		}
		setAdding(null);
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
						onClick={() => setAdding(emptyAccount())}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div className="space-y-2 rounded-2xl border border-border p-3">
					<div className="grid grid-cols-2 gap-2">
						<div>
							<label className="block type-caption">ID</label>
							<Input
								className="w-full rounded-lg "
								value={adding.id}
								onChange={(e) => setAdding({ ...adding, id: e.target.value })}
								placeholder="e.g. savings"
							/>
						</div>
						<div>
							<label className="block type-caption">Label</label>
							<Input
								className="w-full rounded-lg "
								value={adding.label}
								onChange={(e) =>
									setAdding({ ...adding, label: e.target.value })
								}
								placeholder="Savings"
							/>
						</div>
						<div>
							<label className="block type-caption">Color (hex)</label>
							<Input
								className="w-full rounded-lg "
								value={adding.color ?? ""}
								onChange={(e) =>
									setAdding({ ...adding, color: e.target.value || null })
								}
								placeholder="CSS color"
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={commit}>
							Add account
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setAdding(null)}
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
