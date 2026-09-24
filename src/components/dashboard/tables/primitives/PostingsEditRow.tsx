import { TableCell, TableRow } from "@/components/ui/Table";
import {
	getExpression,
	type Posting,
	updateExpressionAmount,
} from "@/lib/projection";
import { PostingAmount } from "../PostingAmount";
import {
	CheckboxCell,
	CommitCell,
	DecimalCell,
	editableCellClass,
} from "./Cells";
import { RowDeleteButton } from "./Shells";

function ExpressionField({
	posting,
	isDirty,
	onCommit,
}: {
	posting: Posting;
	isDirty: boolean;
	onCommit: (amount: Posting["amount"]) => void;
}) {
	const committedValue = getExpression(posting) ?? "";
	return (
		<CommitCell
			aria-label={`${posting.label} amount expression`}
			committedValue={committedValue}
			isDirty={isDirty}
			onCommitDraft={(draft) => {
				try {
					onCommit(updateExpressionAmount(posting.amount, draft));
					return draft;
				} catch {
					return null;
				}
			}}
		/>
	);
}

interface PostingEditRowProps {
	posting: Posting;
	changed: boolean;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
}

export function PostingEditRow({
	posting: p,
	changed,
	updatePosting,
	deletePosting,
}: PostingEditRowProps) {
	return (
		<TableRow>
			<TableCell>
				<CommitCell
					aria-label={`Posting ID for ${p.label}`}
					committedValue={p.id}
					isDirty={changed}
					onCommitDraft={(id) => {
						updatePosting(p.id, { id });
						return id;
					}}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`Posting label for ${p.id}`}
					className={editableCellClass(changed)}
					value={p.label}
					onChange={(e) => updatePosting(p.id, { label: e.target.value })}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`${p.label} source account`}
					className={editableCellClass(changed)}
					value={p.sourceAccountId ?? ""}
					onChange={(e) =>
						updatePosting(p.id, {
							sourceAccountId: e.target.value || null,
						})
					}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`${p.label} destination accounts`}
					className={editableCellClass(changed)}
					value={p.destinations?.join(";") ?? ""}
					onChange={(e) => {
						const raw = e.target.value;
						updatePosting(p.id, {
							destinations: raw.trim()
								? raw.split(";").map((s) => s.trim())
								: null,
						});
					}}
				/>
			</TableCell>
			<TableCell>
				{getExpression(p) !== null ? (
					<ExpressionField
						posting={p}
						isDirty={changed}
						onCommit={(amount) => updatePosting(p.id, { amount })}
					/>
				) : (
					<PostingAmount posting={p} showDetails />
				)}
			</TableCell>
			<TableCell>
				<select
					aria-label={`${p.label} frequency`}
					className={editableCellClass(changed)}
					value={p.frequency}
					onChange={(e) => {
						const frequency = e.target.value as Posting["frequency"];
						updatePosting(p.id, { frequency });
					}}
				>
					<option value="once">once</option>
					<option value="daily">daily</option>
					<option value="weekly">weekly</option>
					<option value="monthly">monthly</option>
					<option value="quarterly">quarterly</option>
					<option value="annual">annual</option>
				</select>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`${p.label} annual rate`}
					isDirty={changed}
					numeric
					step={0.01}
					value={p.annualRate}
					onCommit={(annualRate) =>
						updatePosting(p.id, {
							annualRate: annualRate ?? p.annualRate,
						})
					}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`${p.label} annual growth rate`}
					isDirty={changed}
					numeric
					step={0.01}
					value={p.annualGrowthRate}
					onCommit={(annualGrowthRate) =>
						updatePosting(p.id, {
							annualGrowthRate: annualGrowthRate ?? p.annualGrowthRate,
						})
					}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`${p.label} volatility`}
					isDirty={changed}
					numeric
					min={0}
					step={0.01}
					value={p.volatility}
					onCommit={(volatility) =>
						updatePosting(p.id, {
							volatility: volatility ?? p.volatility,
						})
					}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`${p.label} start date`}
					className={editableCellClass(changed)}
					value={p.startDate}
					onChange={(e) => updatePosting(p.id, { startDate: e.target.value })}
				/>
			</TableCell>
			<TableCell>
				<input
					aria-label={`${p.label} end date`}
					className={editableCellClass(changed)}
					value={p.endDate ?? ""}
					disabled={p.frequency === "once"}
					onChange={(e) =>
						updatePosting(p.id, { endDate: e.target.value || null })
					}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`${p.label} annual cap`}
					isDirty={changed}
					numeric
					emptyValue={null}
					min={0}
					value={p.annualCap}
					onCommit={(annualCap) => updatePosting(p.id, { annualCap })}
				/>
			</TableCell>
			<TableCell>
				<DecimalCell
					label={`${p.label} priority`}
					isDirty={changed}
					numeric
					min={1}
					value={p.priority}
					onCommit={(priority) =>
						updatePosting(p.id, {
							priority: priority ?? p.priority,
						})
					}
				/>
			</TableCell>
			<TableCell>
				<CheckboxCell
					label={`Enable posting ${p.label}`}
					checked={p.enabled}
					onChange={() => updatePosting(p.id, { enabled: !p.enabled })}
				/>
			</TableCell>
			<TableCell>
				<RowDeleteButton
					label={`Delete posting ${p.label}`}
					onClick={() => deletePosting(p.id)}
				/>
			</TableCell>
		</TableRow>
	);
}
