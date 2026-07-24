import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { Account, FinancialModelDocument } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

function inputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-tertiary-border bg-tertiary-subtle"
		: "border-input bg-card";
	return `w-full rounded-lg ${dirty} px-2 py-1 type-body outline-none type-code`;
}

interface EditableAccountsTableProps {
	displayDocument: FinancialModelDocument;
	document: FinancialModelDocument;
	isDirty: boolean;
	workingDocument: FinancialModelDocument | null;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
	addAccount: (account: Account) => void;
}

export function EditableAccountsTable({
	displayDocument,
	document,
	isDirty,
	workingDocument,
	updateAccount,
	deleteAccount,
	addAccount,
}: EditableAccountsTableProps) {
	const documentAccountsById = new Map<string, Account>();
	for (const account of document.accounts) {
		documentAccountsById.set(account.id, account);
	}

	const workingAccountsById = new Map<string, Account>();
	if (workingDocument) {
		for (const a of workingDocument.accounts) {
			workingAccountsById.set(a.id, a);
		}
	}

	return (
		<Card className="rounded-[1.8rem] border-border shadow-sm ">
			<CardHeader>
				<CardTitle>Accounts</CardTitle>
				<CardDescription>Edit, add, or remove account rows.</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>ID</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Min</TableHead>
							<TableHead>Max</TableHead>
							<TableHead>Color</TableHead>
							<TableHead>Enabled</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{displayDocument.accounts.map((a) => {
							const wa = workingAccountsById.get(a.id);
							const pa = documentAccountsById.get(a.id);
							const changed =
								isDirty && wa && JSON.stringify(wa) !== JSON.stringify(pa);

							return (
								<TableRow key={a.id}>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={a.id}
											onChange={(e) =>
												updateAccount(a.id, { id: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={a.label}
											onChange={(e) =>
												updateAccount(a.id, { label: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											value={a.minBalance === NO_FLOOR ? "" : a.minBalance}
											onChange={(e) =>
												updateAccount(a.id, {
													minBalance: e.target.value
														? Number(e.target.value)
														: NO_FLOOR,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											value={a.maxBalance === NO_CEILING ? "" : a.maxBalance}
											onChange={(e) =>
												updateAccount(a.id, {
													maxBalance: e.target.value
														? Number(e.target.value)
														: NO_CEILING,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={a.color ?? ""}
											onChange={(e) =>
												updateAccount(a.id, { color: e.target.value || null })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											type="checkbox"
											className="h-4 w-4 rounded accent-primary"
											checked={a.enabled}
											onChange={() =>
												updateAccount(a.id, { enabled: !a.enabled })
											}
										/>
									</TableCell>
									<TableCell>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => deleteAccount(a.id)}
										>
											✕
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
				<div className="mt-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() =>
							addAccount({
								id: `new-account-${Date.now()}`,
								label: "New account",
								minBalance: NO_FLOOR,
								maxBalance: NO_CEILING,
								color: null,
								enabled: true,
							})
						}
					>
						+ Add account
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
