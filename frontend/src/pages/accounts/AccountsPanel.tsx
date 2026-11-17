import { LockKeyhole, Wallet } from "lucide-react";
import { AccountLabel } from "../../components/AccountIcon.tsx";
import { displayCurrentBalance } from "../../domain/accountDisplay.ts";
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
}: {
	accounts: Account[];
	showHeaders?: boolean;
	onAccount: (id: string) => void;
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
			className="border-collapse text-left max-sm:table-fixed"
			containerClassName="max-w-full"
			containerProps={{
				role: "region",
				"aria-label": "Accounts and current balances.",
			}}
		>
			<TableCaption className="sr-only">
				Accounts and current balances.
			</TableCaption>
			<colgroup>
				<col />
				<col className="max-sm:w-24" />
			</colgroup>
			{showHeaders && (
				<TableHeader>
					<TableRow>
						<TableHead className="max-sm:px-2 max-sm:py-3">Account</TableHead>
						<TableHead className="text-right max-sm:whitespace-normal max-sm:px-1 max-sm:py-3">
							Current balance
						</TableHead>
					</TableRow>
				</TableHeader>
			)}
			<TableBody>
				{accounts.map((account) => {
					// Current balance follows the account's display basis:
					// posted shows the posted total, available (the default)
					// shows the bank-reported figure. Manual accounts without
					// bank evidence keep their saved balance; synced or
					// grouped accounts without evidence show unavailable
					// rather than borrowing the modeled balance.
					const current = displayCurrentBalance(account);
					return (
						<TableRow
							key={account.id}
							className="group cursor-pointer hover:bg-muted"
							onClick={(event) => {
								if ((event.target as HTMLElement).closest("button")) return;
								onAccount(account.id);
							}}
						>
							<TableHead
								scope="row"
								className="py-5 max-sm:min-w-0 max-sm:whitespace-normal max-sm:px-2 max-sm:py-4"
							>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="group h-auto max-w-full justify-start gap-3 px-1 py-0.5 text-left font-normal max-sm:min-w-0 max-sm:gap-1.5 max-sm:px-0"
									aria-label={`Open ${account.name} transactions`}
									onClick={() => onAccount(account.id)}
								>
									<AccountLabel
										account={account}
										title={account.name}
										className="max-sm:gap-2"
										nameClassName="truncate group-hover:text-primary group-hover:underline group-hover:underline-offset-4"
										suffix={!account.enabled ? " · excluded" : undefined}
									/>
									{account.readOnly && (
										<LockKeyhole
											size={14}
											aria-label="Read-only record"
											className="shrink-0"
										/>
									)}
								</Button>
							</TableHead>
							<TableCell className="text-right tabular-nums max-sm:whitespace-nowrap max-sm:px-1 max-sm:py-4">
								<div>
									{current === null ? (
										<span className="text-muted-foreground">Unavailable</span>
									) : (
										money(current)
									)}
								</div>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
