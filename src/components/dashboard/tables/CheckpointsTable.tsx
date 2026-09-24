import {
	createTableColumn,
	DataTable,
	formatCurrency,
	type TableColumn,
} from "@/components/ui/DataTable";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/Table";
import { formatDate } from "@/lib/format";
import type { Checkpoint, FinancialModelDocument } from "@/lib/projection";
import { DecimalCell, plainCellClass } from "./primitives/Cells";
import { SearchField, useSearchFilter } from "./primitives/Search";
import {
	AddRowButton,
	EditableTableCard,
	RowDeleteButton,
} from "./primitives/Shells";

export interface CheckpointsTableEditProps {
	displayDocument: FinancialModelDocument;
	projectionStartDate: string;
	updateCheckpoint: (index: number, changes: Partial<Checkpoint>) => void;
	deleteCheckpoint: (index: number) => void;
	addCheckpoint: (checkpoint: Checkpoint) => void;
}

export interface CheckpointsTableViewProps {
	checkpoints: Checkpoint[];
	showAdvanced: boolean;
	accountLabelById: Map<string, string>;
}

export type CheckpointsTableProps =
	| ({ editable: true } & CheckpointsTableEditProps)
	| ({ editable?: false } & CheckpointsTableViewProps);

export function CheckpointsTable(props: CheckpointsTableProps) {
	if (props.editable === true) {
		const { editable, ...editProps } = props;
		return <EditableCheckpointsGrid {...editProps} />;
	}
	const { editable, ...viewProps } = props;
	return <ReadOnlyCheckpointsView {...viewProps} />;
}

const checkpointColumn = createTableColumn<Checkpoint>();

export function checkpointColumns(
	showAdvanced: boolean,
	accountLabelById: ReadonlyMap<string, string>,
): TableColumn<Checkpoint>[] {
	return [
		checkpointColumn({ key: "Date", label: "As of", format: formatDate }),
		checkpointColumn({
			key: "AccountId",
			label: showAdvanced ? "Account ID" : "Account",
			format: (accountId) =>
				showAdvanced
					? accountId
					: (accountLabelById.get(accountId) ?? accountId),
		}),
		checkpointColumn({
			key: "Balance",
			label: "Observed balance",
			format: formatCurrency,
		}),
	];
}

function EditableCheckpointsGrid({
	displayDocument,
	projectionStartDate,
	updateCheckpoint,
	deleteCheckpoint,
	addCheckpoint,
}: CheckpointsTableEditProps) {
	return (
		<EditableTableCard
			title="Balance checkpoints"
			description="Record absolute end-of-day balances. Later modeled postings continue from these observed values."
			footer={
				<AddRowButton
					onClick={() =>
						addCheckpoint({
							Date: projectionStartDate,
							AccountId: displayDocument.accounts[0]?.id ?? "",
							Balance: 0,
						})
					}
				>
					Add checkpoint
				</AddRowButton>
			}
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Date</TableHead>
						<TableHead>Account</TableHead>
						<TableHead>Balance</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{displayDocument.checkpoints.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={4}
								className="py-6 text-center text-muted-foreground"
							>
								No checkpoints yet. Add one below to record an observed balance.
							</TableCell>
						</TableRow>
					) : null}
					{displayDocument.checkpoints.map((checkpoint, index) => (
						<TableRow
							key={`${checkpoint.AccountId}:${checkpoint.Date}:${index}`}
						>
							<TableCell>
								<input
									className={plainCellClass}
									type="date"
									aria-label={`Checkpoint date for row ${index + 1}`}
									value={checkpoint.Date}
									onChange={(event) =>
										updateCheckpoint(index, { Date: event.target.value })
									}
								/>
							</TableCell>
							<TableCell>
								<select
									className={plainCellClass}
									aria-label={`Checkpoint account for row ${index + 1}`}
									value={checkpoint.AccountId}
									onChange={(event) =>
										updateCheckpoint(index, {
											AccountId: event.target.value,
										})
									}
								>
									<option value="">Select account</option>
									{displayDocument.accounts.map((account) => (
										<option key={account.id} value={account.id}>
											{account.label}
										</option>
									))}
								</select>
							</TableCell>
							<TableCell>
								<DecimalCell
									label={`Checkpoint balance for row ${index + 1}`}
									value={checkpoint.Balance}
									isDirty={false}
									onCommit={(balance) => {
										// Blank drafts are rejected (kept + announced), never
										// committed as Number("") === 0.
										if (balance !== null)
											updateCheckpoint(index, { Balance: balance });
									}}
								/>
							</TableCell>
							<TableCell>
								<RowDeleteButton onClick={() => deleteCheckpoint(index)}>
									Remove
								</RowDeleteButton>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</EditableTableCard>
	);
}

function ReadOnlyCheckpointsView({
	checkpoints,
	showAdvanced,
	accountLabelById,
}: CheckpointsTableViewProps) {
	const {
		search,
		setSearch,
		visible: rows,
	} = useSearchFilter(checkpoints, (checkpoint, normalizedSearch) => {
		const accountLabel =
			accountLabelById.get(checkpoint.AccountId) ?? checkpoint.AccountId;
		return (
			!normalizedSearch ||
			checkpoint.Date.includes(normalizedSearch) ||
			checkpoint.AccountId.toLowerCase().includes(normalizedSearch) ||
			accountLabel.toLowerCase().includes(normalizedSearch)
		);
	});

	return (
		<div>
			<SearchField
				value={search}
				onChange={setSearch}
				placeholder="Search balance checkpoints..."
				ariaLabel="Search balance checkpoints"
				resultCount={rows.length}
				resultLabel={rows.length === 1 ? "checkpoint" : "checkpoints"}
			/>
			<DataTable
				title="Balance checkpoints"
				description="Absolute end-of-day balances that correct modeled history before later postings continue."
				rows={rows}
				rowKey={(checkpoint) => `${checkpoint.AccountId}:${checkpoint.Date}`}
				emptyText="No balance checkpoints."
				variant="flat"
				columns={checkpointColumns(showAdvanced, accountLabelById)}
			/>
		</div>
	);
}
