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
import type { Posting, ScenarioPack } from "@/lib/projection";

function inputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950"
		: "border-slate-200 dark:border-slate-700";
	return `w-full rounded-lg ${dirty} px-2 py-1 text-sm outline-none font-mono text-xs`;
}

interface EditablePostingsTableProps {
	displayPack: ScenarioPack;
	pack: ScenarioPack;
	isDirty: boolean;
	workingPack: ScenarioPack | null;
	projectionStartDate: string;
	updatePosting: (id: string, changes: Partial<Posting>) => void;
	deletePosting: (id: string) => void;
	addPosting: (posting: Posting) => void;
}

export function EditablePostingsTable({
	displayPack,
	pack,
	isDirty,
	workingPack,
	projectionStartDate,
	updatePosting,
	deletePosting,
	addPosting,
}: EditablePostingsTableProps) {
	return (
		<Card className="rounded-[1.8rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
			<CardHeader>
				<CardTitle>Postings</CardTitle>
				<CardDescription>Edit, add, or remove posting rows.</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>ID</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Source</TableHead>
							<TableHead>Destinations</TableHead>
							<TableHead>Arithmetic</TableHead>
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
						{displayPack.postings.map((p, pi) => {
							const changed =
								isDirty &&
								workingPack?.postings[pi] &&
								JSON.stringify(workingPack.postings[pi]) !==
									JSON.stringify(pack.postings[pi]);
							return (
								<TableRow key={p.id}>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={p.id}
											onChange={(e) =>
												updatePosting(p.id, { id: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={p.label}
											onChange={(e) =>
												updatePosting(p.id, { label: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
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
											className={inputStyle(!!changed)}
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
										<input
											className={inputStyle(!!changed)}
											value={p.arithmetic}
											onChange={(e) =>
												updatePosting(p.id, { arithmetic: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<select
											className={inputStyle(!!changed)}
											value={p.frequency}
											onChange={(e) =>
												updatePosting(p.id, {
													frequency: e.target.value as Posting["frequency"],
												})
											}
										>
											<option value="daily">daily</option>
											<option value="weekly">weekly</option>
											<option value="monthly">monthly</option>
											<option value="quarterly">quarterly</option>
											<option value="annual">annual</option>
										</select>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											step={0.01}
											value={p.annualRate}
											onChange={(e) =>
												updatePosting(p.id, {
													annualRate: Number(e.target.value),
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											step={0.01}
											value={p.annualGrowthRate}
											onChange={(e) =>
												updatePosting(p.id, {
													annualGrowthRate: Number(e.target.value),
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											min={0}
											step={0.01}
											value={p.volatility}
											onChange={(e) =>
												updatePosting(p.id, {
													volatility: Number(e.target.value),
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={p.startDate}
											onChange={(e) =>
												updatePosting(p.id, { startDate: e.target.value })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											value={p.endDate ?? ""}
											onChange={(e) =>
												updatePosting(p.id, { endDate: e.target.value || null })
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											min={0}
											value={p.annualCap ?? ""}
											onChange={(e) =>
												updatePosting(p.id, {
													annualCap: e.target.value
														? Number(e.target.value)
														: null,
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											className={inputStyle(!!changed)}
											type="number"
											min={1}
											value={p.priority}
											onChange={(e) =>
												updatePosting(p.id, {
													priority: Math.max(1, Number(e.target.value)),
												})
											}
										/>
									</TableCell>
									<TableCell>
										<input
											type="checkbox"
											className="h-4 w-4 rounded accent-slate-700"
											checked={p.enabled}
											onChange={() =>
												updatePosting(p.id, { enabled: !p.enabled })
											}
										/>
									</TableCell>
									<TableCell>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => deletePosting(p.id)}
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
							addPosting({
								id: `new-posting-${Date.now()}`,
								label: "New posting",
								sourceAccountId: null,
								destinations: null,
								arithmetic: "0",
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
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
