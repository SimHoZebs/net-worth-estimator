import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	createTableColumn,
	DataTable,
	formatCurrency,
	type TableColumn,
} from "@/components/ui/data-table";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TableSearch } from "@/components/ui/table-search";
import { formatDate } from "@/lib/format";
import type { Checkpoint, FinancialModelDocument } from "@/lib/projection";
import { useTableSearch } from "./_shared";

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

const inputClassName =
	"w-full rounded-lg border border-input bg-card px-2 py-1 type-body outline-none type-code focus:border-ring";

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
		<Card className="rounded-[1.8rem] border-border shadow-sm">
			<CardHeader>
				<CardTitle>Balance checkpoints</CardTitle>
				<CardDescription>
					Record absolute end-of-day balances. Later modeled postings continue
					from these observed values.
				</CardDescription>
			</CardHeader>
			<CardContent>
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
						{displayDocument.checkpoints.map((checkpoint, index) => (
							<TableRow
								key={`${checkpoint.AccountId}:${checkpoint.Date}:${index}`}
							>
								<TableCell>
									<input
										className={inputClassName}
										type="date"
										value={checkpoint.Date}
										onChange={(event) =>
											updateCheckpoint(index, { Date: event.target.value })
										}
									/>
								</TableCell>
								<TableCell>
									<select
										className={inputClassName}
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
									<input
										className={inputClassName}
										type="number"
										step="any"
										value={checkpoint.Balance}
										onChange={(event) =>
											updateCheckpoint(index, {
												Balance: Number(event.target.value),
											})
										}
									/>
								</TableCell>
								<TableCell>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => deleteCheckpoint(index)}
									>
										Remove
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<div className="mt-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() =>
							addCheckpoint({
								Date: projectionStartDate,
								AccountId: displayDocument.accounts[0]?.id ?? "",
								Balance: 0,
							})
						}
					>
						Add checkpoint
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ReadOnlyCheckpointsView({
	checkpoints,
	showAdvanced,
	accountLabelById,
}: CheckpointsTableViewProps) {
	const { search, setSearch, query: normalizedSearch } = useTableSearch();
	const rows = checkpoints.filter((checkpoint) => {
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
			<TableSearch
				value={search}
				onChange={setSearch}
				placeholder="Search balance checkpoints..."
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
