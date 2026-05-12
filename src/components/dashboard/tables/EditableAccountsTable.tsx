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
import type { Account, ScenarioPack } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

function inputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950"
		: "border-slate-200 dark:border-slate-700";
	return `w-full rounded-lg ${dirty} px-2 py-1 text-sm outline-none font-mono text-xs`;
}

interface EditableAccountsTableProps {
	displayPack: ScenarioPack;
	pack: ScenarioPack;
	isDirty: boolean;
	workingPack: ScenarioPack | null;
	updateAccount: (id: string, changes: Partial<Account>) => void;
	deleteAccount: (id: string) => void;
	addAccount: (account: Account) => void;
}

export function EditableAccountsTable({
	displayPack,
	pack,
	isDirty,
	workingPack,
	updateAccount,
	deleteAccount,
	addAccount,
}: EditableAccountsTableProps) {
	return (
		<Card className="rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
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
						{displayPack.accounts.map((a) => {
							const changed =
								isDirty &&
								workingPack?.accounts.some(
									(wa) =>
										wa.id === a.id &&
										JSON.stringify(wa) !==
											JSON.stringify(
												pack.accounts.find((pa) => pa.id === a.id),
											),
								);
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
											className="h-4 w-4 rounded accent-slate-700"
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
