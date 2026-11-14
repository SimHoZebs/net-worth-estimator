import { LockKeyhole, Pencil, Trash2, Wallet } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty.tsx";
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
			<Empty className="flex w-full min-w-0 flex-initial flex-col items-center gap-0 px-6 py-12 text-center">
				<EmptyHeader>
					<EmptyMedia>
						<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
							<Wallet size={28} />
						</span>
					</EmptyMedia>
					<h3 className="text-lg">No matching accounts</h3>
				</EmptyHeader>
			</Empty>
		);
	return (
		<Table
			className="border-collapse text-left"
			containerClassName="max-w-full"
			containerProps={{
				role: "region",
				"aria-label": "Accounts with balances.",
			}}
		>
			<TableCaption className="sr-only">Accounts with balances.</TableCaption>
			{showHeaders && (
				<TableHeader>
					<TableRow>
						<TableHead className="max-sm:p-4">Account</TableHead>
						<TableHead className="max-sm:p-4">Balance</TableHead>
						<TableHead className="max-sm:p-4">
							<span className="sr-only">Actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
			)}
			<TableBody>
				{accounts.map((account) => (
					<TableRow
						key={account.id}
						className="group cursor-pointer hover:bg-muted"
						onClick={(event) => {
							if ((event.target as HTMLElement).closest("button")) return;
							onAccount(account.id);
						}}
					>
						<TableHead scope="row" className="py-5 max-sm:px-4 max-sm:py-5">
							<button
								type="button"
								className="group flex items-center gap-3 rounded-md border-0 bg-transparent text-left text-inherit"
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
							</button>
						</TableHead>
						<TableCell className="tabular-nums max-sm:p-4">
							<div>{money(account.balance)}</div>
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
				))}
			</TableBody>
		</Table>
	);
}
