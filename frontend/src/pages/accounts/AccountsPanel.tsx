import { LockKeyhole, Pencil, Trash2, Wallet } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import { money } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";

export function AccountsPanel({
	accounts,
	showHeaders = false,
	onAccount,
	onEdit,
	onRemove,
}: {
	accounts: Account[];
	showHeaders?: boolean;
	onAccount: (id: string) => void;
	onEdit: (account: Account) => void;
	onRemove: (account: Account) => void;
}) {
	if (!accounts.length)
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Wallet aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No matching accounts</EmptyTitle>
				</EmptyHeader>
			</Empty>
		);
	return (
		<Table
			className="border-collapse text-left"
			containerClassName="max-w-full"
			containerProps={{
				role: "region",
				"aria-label": "Accounts and current available balances.",
			}}
		>
			<TableCaption className="sr-only">
				Accounts and current available balances.
			</TableCaption>
			{showHeaders && (
				<TableHeader>
					<TableRow>
						<TableHead className="max-sm:p-4">Account</TableHead>
						<TableHead className="max-sm:p-4">Available balance</TableHead>
						<TableHead className="max-sm:p-4">
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
			)}
			<TableBody>
				{accounts.map((account) => {
					// Current balance is the bank-reported available figure only.
					// The modeled balance is projection and net-worth authority,
					// never a substitute for missing current evidence.
					const available = account.availableBalance ?? null;
					return (
						<TableRow
							key={account.id}
							className="group cursor-pointer hover:bg-muted"
							onClick={(event) => {
								if ((event.target as HTMLElement).closest("button")) return;
								onAccount(account.id);
							}}
						>
							<TableHead scope="row" className="py-5 max-sm:px-4 max-sm:py-5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="group h-auto justify-start gap-3 px-1 py-0.5 text-left font-normal"
									aria-label={`Open ${account.name} transactions`}
									onClick={() => onAccount(account.id)}
								>
									<AccountLabel
										account={account}
										nameClassName="group-hover:text-primary group-hover:underline group-hover:underline-offset-4"
										suffix={!account.enabled ? " · excluded" : undefined}
									/>
									{account.readOnly && (
										<LockKeyhole size={14} aria-label="Read-only record" />
									)}
								</Button>
							</TableHead>
							<TableCell className="tabular-nums max-sm:p-4">
								<div>
									{available === null ? (
										<span className="text-muted-foreground">Unavailable</span>
									) : (
										money(available)
									)}
								</div>
							</TableCell>
							<TableCell className="max-sm:p-4">
								<div className="flex justify-end gap-1">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Edit ${account.name}`}
										onClick={() => onEdit(account)}
									>
										<Pencil aria-hidden="true" />
									</Button>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Remove ${account.name}`}
										disabled={account.readOnly}
										onClick={() => onRemove(account)}
									>
										<Trash2 aria-hidden="true" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
