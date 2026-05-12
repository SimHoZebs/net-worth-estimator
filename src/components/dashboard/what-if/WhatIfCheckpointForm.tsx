import { useState } from "react";
import { Button } from "@/components/ui/button";
import { currency } from "@/lib/format";
import type { Checkpoint } from "@/lib/projection";

function emptyCheckpoint(): Checkpoint {
	return {
		Date: "",
		AccountId: "",
		Balance: 0,
	};
}

interface WhatIfCheckpointFormProps {
	checkpoints: Checkpoint[];
	onAdd: (checkpoint: Checkpoint) => void;
	onRemove: (index: number) => void;
}

export function WhatIfCheckpointForm({
	checkpoints,
	onAdd,
	onRemove,
}: WhatIfCheckpointFormProps) {
	const [adding, setAdding] = useState<Checkpoint | null>(null);

	const commit = () => {
		if (adding?.Date.trim() && adding.AccountId.trim()) {
			onAdd(adding);
		}
		setAdding(null);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
					Balance checkpoints{" "}
					{checkpoints.length > 0 ? `(${checkpoints.length})` : ""}
				</span>
				{!adding ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setAdding(emptyCheckpoint())}
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
								Date
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.Date}
								onChange={(e) => setAdding({ ...adding, Date: e.target.value })}
								placeholder="YYYY-MM-DD"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Account ID
							</label>
							<input
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.AccountId}
								onChange={(e) =>
									setAdding({ ...adding, AccountId: e.target.value })
								}
								placeholder="e.g. checking"
							/>
						</div>
						<div>
							<label className="block text-xs text-slate-500 dark:text-slate-400">
								Balance
							</label>
							<input
								type="number"
								className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
								value={adding.Balance}
								onChange={(e) =>
									setAdding({ ...adding, Balance: Number(e.target.value) })
								}
							/>
						</div>
					</div>
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={commit}>
							Add checkpoint
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
			{checkpoints.map((checkpoint, index) => (
				<div
					key={`tmp-chk-${index}`}
					className="flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-2"
				>
					<div>
						<span className="text-sm font-medium text-amber-900 dark:text-amber-200">
							{checkpoint.Date}
						</span>
						<span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
							{checkpoint.AccountId}
						</span>
						<span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
							{currency.format(checkpoint.Balance)}
						</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onRemove(index)}
					>
						Remove
					</Button>
				</div>
			))}
		</div>
	);
}
