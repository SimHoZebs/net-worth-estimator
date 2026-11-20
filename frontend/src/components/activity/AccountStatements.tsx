import { useState } from "react";
import { saveCardStatement } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { Button } from "@/components/ui/button.tsx";
import { dateLabel, exactMoney } from "@/domain/format.ts";
import { statementStatusLabel } from "@/domain/statementPayment.ts";
import { statementStatusFromTotals } from "@/domain/statementPaymentAdapter.ts";
import {
	refreshCardStatements,
	useCardStatements,
} from "@/state/cardStatements.ts";
import { StatementEntry, type StatementEntryValue } from "./StatementEntry.tsx";

export function AccountStatements({
	accountId,
	accountName,
	readOnly,
}: {
	accountId: string;
	accountName: string;
	readOnly: boolean;
}) {
	const statements = useCardStatements(accountId);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const editing = statements.data?.find(
		({ statement }) => statement.id === editingId,
	)?.statement;

	const save = async ({
		statementClose,
		statementBalance,
		dueDate,
	}: StatementEntryValue) => {
		if (readOnly || saving) return false;
		const scope = getUserScope();
		setSaving(true);
		setError(null);
		try {
			await saveCardStatement({
				accountId,
				closingDate: statementClose,
				dueDate,
				balance: statementBalance,
				currency: "USD",
				id: editing?.id,
			});
			await refreshCardStatements(scope);
			setEditingId(null);
			return true;
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "The statement could not be saved.",
			);
			return false;
		} finally {
			setSaving(false);
		}
	};

	return (
		<section aria-label="Card statements" className="grid gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="m-0 text-base font-semibold">Card statements</h3>
				{!readOnly && editingId === null && (
					<Button
						type="button"
						variant="secondary"
						onClick={() => setEditingId("")}
					>
						Add statement
					</Button>
				)}
			</div>
			{editingId !== null && !readOnly && (
				<StatementEntry
					key={editingId}
					accountLabel={accountName}
					initial={
						editing && {
							statementClose: editing.closingDate,
							statementBalance: String(editing.balance),
							dueDate: editing.dueDate,
						}
					}
					editing={Boolean(editing)}
					saving={saving}
					error={error}
					onSubmit={save}
					onCancel={() => {
						setEditingId(null);
						setError(null);
					}}
				/>
			)}
			{statements.isError ? (
				<p role="alert">
					Card statements could not be loaded.{" "}
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => void statements.refetch()}
					>
						Retry
					</Button>
				</p>
			) : statements.isPending ? (
				<p className="text-sm text-muted-foreground">Loading statements…</p>
			) : statements.data.length === 0 ? (
				<p className="text-sm text-muted-foreground">No recorded statements.</p>
			) : (
				<ul className="divide-y divide-border">
					{statements.data.map(({ statement, allocated, remaining }) => (
						<li
							key={statement.id}
							className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"
						>
							<div>
								<p className="font-medium">
									{dateLabel(statement.closingDate, true)} statement
								</p>
								<p className="text-muted-foreground">
									Due {dateLabel(statement.dueDate, true)} ·{" "}
									{exactMoney(statement.balance)} billed
								</p>
							</div>
							<p>
								{remaining > 0 && `${exactMoney(remaining)} remaining · `}
								{statementStatusLabel(
									statementStatusFromTotals(allocated, remaining),
								)}
							</p>
							{!readOnly && editingId === null && allocated === 0 && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={`Edit ${dateLabel(statement.closingDate, true)} statement`}
									onClick={() => setEditingId(statement.id)}
								>
									Edit
								</Button>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
