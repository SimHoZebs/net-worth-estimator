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
import type { Checkpoint, ScenarioPack } from "@/lib/projection";

function inputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-tertiary-border bg-tertiary-subtle"
		: "border-input bg-card";
	return `w-full rounded-lg ${dirty} px-2 py-1 type-body outline-none type-code`;
}

interface EditableCheckpointsTableProps {
	displayPack: ScenarioPack;
	isDirty: boolean;
	projectionStartDate: string;
	updateCheckpoint: (index: number, changes: Partial<Checkpoint>) => void;
	deleteCheckpoint: (index: number) => void;
	addCheckpoint: (checkpoint: Checkpoint) => void;
}

export function EditableCheckpointsTable({
	displayPack,
	isDirty,
	projectionStartDate,
	updateCheckpoint,
	deleteCheckpoint,
	addCheckpoint,
}: EditableCheckpointsTableProps) {
	return (
		<Card className="rounded-[1.8rem] border-border shadow-sm ">
			<CardHeader>
				<CardTitle>Balance history</CardTitle>
				<CardDescription>
					Edit, add, or remove balance checkpoint rows.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Account ID</TableHead>
							<TableHead>Balance</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{displayPack.checkpoints.map((c, ci) => (
							<TableRow key={ci}>
								<TableCell>
									<input
										className={inputStyle(!!isDirty)}
										value={c.Date}
										onChange={(e) =>
											updateCheckpoint(ci, { Date: e.target.value })
										}
									/>
								</TableCell>
								<TableCell>
									<input
										className={inputStyle(!!isDirty)}
										value={c.AccountId}
										onChange={(e) =>
											updateCheckpoint(ci, { AccountId: e.target.value })
										}
									/>
								</TableCell>
								<TableCell>
									<input
										className={inputStyle(!!isDirty)}
										type="number"
										value={c.Balance}
										onChange={(e) =>
											updateCheckpoint(ci, { Balance: Number(e.target.value) })
										}
									/>
								</TableCell>
								<TableCell>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => deleteCheckpoint(ci)}
									>
										✕
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
								AccountId: "",
								Balance: 0,
							})
						}
					>
						+ Add checkpoint
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
