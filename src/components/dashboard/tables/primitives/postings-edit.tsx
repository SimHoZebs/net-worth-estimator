import {
	Table,
	TableBody,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { createExpressionAmount } from "@/lib/projection";
import { nextReadableId, useChangedIds, useRowById } from "../_shared";
import type { PostingsTableEditProps } from "../PostingsTable";
import { PostingEditRow } from "./postings-edit-row";
import { AddRowButton, EditableTableCard } from "./shells";

export function EditablePostingsGrid({
	displayDocument,
	document,
	isDirty,
	workingDocument,
	projectionStartDate,
	updatePosting,
	deletePosting,
	addPosting,
}: PostingsTableEditProps) {
	const originalPostingById = useRowById(document.postings);
	const changedPostingIds = useChangedIds(
		originalPostingById,
		workingDocument?.postings,
		isDirty,
	);

	return (
		<EditableTableCard
			title="Posting definitions"
			description="Edit the canonical amount calculations and scheduling fields. New rows get a readable ID (new-posting, new-posting-2, …) — rename it in the ID cell."
			footer={
				<AddRowButton
					onClick={() =>
						addPosting({
							id: nextReadableId(
								"new-posting",
								displayDocument.postings.map((p) => p.id),
							),
							label: "New posting",
							sourceAccountId: null,
							destinations: null,
							amount: createExpressionAmount("0"),
							frequency: "monthly",
							annualRate: 0,
							annualGrowthRate: 0,
							volatility: 0,
							startDate: projectionStartDate,
							endDate: null,
							annualCap: null,
							priority: 1,
							enabled: true,
						})
					}
				>
					+ Add posting
				</AddRowButton>
			}
		>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>ID</TableHead>
						<TableHead>Label</TableHead>
						<TableHead>Source</TableHead>
						<TableHead>Destinations</TableHead>
						<TableHead>Amount calculation</TableHead>
						<TableHead>Freq</TableHead>
						<TableHead>Rate</TableHead>
						<TableHead>Growth</TableHead>
						<TableHead>Vol</TableHead>
						<TableHead>Start</TableHead>
						<TableHead>End</TableHead>
						<TableHead>Cap</TableHead>
						<TableHead>Pri</TableHead>
						<TableHead>Enabled</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{displayDocument.postings.map((p) => {
						const changed = changedPostingIds.has(p.id);
						return (
							<PostingEditRow
								key={p.id}
								posting={p}
								changed={changed}
								updatePosting={updatePosting}
								deletePosting={deletePosting}
							/>
						);
					})}
				</TableBody>
			</Table>
		</EditableTableCard>
	);
}
