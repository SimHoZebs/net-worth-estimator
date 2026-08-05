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
import type { Checkpoint, FinancialModelDocument } from "@/lib/projection";

const inputClassName =
	"w-full rounded-lg border border-input bg-card px-2 py-1 type-body outline-none type-code focus:border-ring";

interface EditableCheckpointsTableProps {
	displayDocument: FinancialModelDocument;
	projectionStartDate: string;
	updateCheckpoint: (index: number, changes: Partial<Checkpoint>) => void;
	deleteCheckpoint: (index: number) => void;
	addCheckpoint: (checkpoint: Checkpoint) => void;
}

export function EditableCheckpointsTable({
	displayDocument,
	projectionStartDate,
	updateCheckpoint,
	deleteCheckpoint,
	addCheckpoint,
}: EditableCheckpointsTableProps) {
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
