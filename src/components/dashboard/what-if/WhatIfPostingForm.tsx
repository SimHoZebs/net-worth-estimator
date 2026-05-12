import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatRoute } from "@/lib/format";
import type { Posting, ScenarioPack } from "@/lib/projection";

function emptyPosting(): Posting {
	return {
		id: "",
		label: "",
		sourceAccountId: null,
		destinations: null,
		arithmetic: "",
		frequency: "monthly",
		annualRate: 0,
		annualGrowthRate: 0,
		volatility: 0,
		startDate: "",
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
}

function describeRoute(posting: Posting, pack: ScenarioPack) {
	const accountById = new Map(pack.accounts.map((a) => [a.id, a]));
	const sourceLabel = posting.sourceAccountId
		? (accountById.get(posting.sourceAccountId)?.label ??
			posting.sourceAccountId)
		: null;
	const destinations = posting.destinations
		? posting.destinations.map((destId) => ({
				label: accountById.get(destId)?.label ?? destId,
			}))
		: null;
	return formatRoute(sourceLabel, destinations);
}

interface WhatIfPostingFormProps {
	postings: Posting[];
	pack: ScenarioPack;
	onAdd: (posting: Posting) => void;
	onRemove: (id: string) => void;
}

export function WhatIfPostingForm({
	postings,
	pack,
	onAdd,
	onRemove,
}: WhatIfPostingFormProps) {
	const [adding, setAdding] = useState<Posting | null>(null);

	const commit = () => {
		if (adding?.id.trim()) {
			onAdd(adding);
		}
		setAdding(null);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
					Scheduled transactions{" "}
					{postings.length > 0 ? `(${postings.length})` : ""}
				</span>
				{!adding ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setAdding(emptyPosting())}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
					<div className="grid grid-cols-2 gap-2">
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								ID
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.id}
								onChange={(e) => setAdding({ ...adding, id: e.target.value })}
								placeholder="e.g. bonus"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Label
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.label}
								onChange={(e) =>
									setAdding({ ...adding, label: e.target.value })
								}
								placeholder="Bonus"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Source Account
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.sourceAccountId ?? ""}
								onChange={(e) =>
									setAdding({
										...adding,
										sourceAccountId: e.target.value || null,
									})
								}
								placeholder="Leave blank for external"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Destinations (; separated)
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.destinations?.join(";") ?? ""}
								onChange={(e) => {
									const raw = e.target.value;
									setAdding({
										...adding,
										destinations: raw.trim()
											? raw.split(";").map((s) => s.trim())
											: null,
									});
								}}
								placeholder="Leave blank for external"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Arithmetic
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.arithmetic}
								onChange={(e) =>
									setAdding({ ...adding, arithmetic: e.target.value })
								}
								placeholder="e.g. 15000"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Frequency
							</label>
							<select
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.frequency}
								onChange={(e) =>
									setAdding({
										...adding,
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
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Annual Rate
							</label>
							<input
								type="number"
								step={0.01}
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.annualRate}
								onChange={(e) =>
									setAdding({ ...adding, annualRate: Number(e.target.value) })
								}
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Annual Growth Rate
							</label>
							<input
								type="number"
								step={0.01}
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.annualGrowthRate}
								onChange={(e) =>
									setAdding({
										...adding,
										annualGrowthRate: Number(e.target.value),
									})
								}
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Volatility
							</label>
							<input
								type="number"
								min={0}
								step={0.01}
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.volatility}
								onChange={(e) =>
									setAdding({ ...adding, volatility: Number(e.target.value) })
								}
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Start Date
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.startDate}
								onChange={(e) =>
									setAdding({ ...adding, startDate: e.target.value })
								}
								placeholder="YYYY-MM-DD"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								End Date
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.endDate ?? ""}
								onChange={(e) =>
									setAdding({ ...adding, endDate: e.target.value || null })
								}
								placeholder="YYYY-MM-DD or blank"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Annual Cap
							</label>
							<input
								type="number"
								min={0}
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.annualCap ?? ""}
								onChange={(e) =>
									setAdding({
										...adding,
										annualCap: e.target.value ? Number(e.target.value) : null,
									})
								}
								placeholder="Blank for none"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Priority
							</label>
							<input
								type="number"
								min={1}
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.priority}
								onChange={(e) =>
									setAdding({
										...adding,
										priority: Math.max(1, Number(e.target.value)),
									})
								}
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={commit}>
							Add posting
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => setAdding(null)}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
			{postings.map((posting) => (
				<div
					key={`tmp-pst-${posting.id}`}
					className="flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-2"
				>
					<div>
						<span className="text-sm font-medium text-amber-900 dark:text-amber-200">
							{posting.label}
						</span>
						<span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
							{posting.arithmetic}
						</span>
						<span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
							{describeRoute(posting, pack)}
						</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onRemove(posting.id)}
					>
						Remove
					</Button>
				</div>
			))}
		</div>
	);
}
