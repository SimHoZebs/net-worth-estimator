import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currency } from "@/lib/format";
import type { Checkpoint } from "@/lib/projection";

function emptyCheckpoint(): Checkpoint {
	return {
		Date: "",
		AccountId: "",
		Balance: 0,
	};
}

interface TemporaryCheckpointFormProps {
	checkpoints: Checkpoint[];
	onAdd: (checkpoint: Checkpoint) => void;
	onRemove: (index: number) => void;
}

export function TemporaryCheckpointForm({
	checkpoints,
	onAdd,
	onRemove,
}: TemporaryCheckpointFormProps) {
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
				<span className="type-eyebrow">
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
				<div className="space-y-2 rounded-2xl border border-border p-3">
					<div className="grid grid-cols-2 gap-2">
						<div>
							<label className="block type-caption">Date</label>
							<Input
								className="w-full rounded-lg "
								value={adding.Date}
								onChange={(e) => setAdding({ ...adding, Date: e.target.value })}
								placeholder="YYYY-MM-DD"
							/>
						</div>
						<div>
							<label className="block type-caption">Account ID</label>
							<Input
								className="w-full rounded-lg "
								value={adding.AccountId}
								onChange={(e) =>
									setAdding({ ...adding, AccountId: e.target.value })
								}
								placeholder="e.g. checking"
							/>
						</div>
						<div>
							<label className="block type-caption">Balance</label>
							<Input
								type="number"
								className="w-full rounded-lg "
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
					className="flex items-center justify-between rounded-xl border border-tertiary-border bg-tertiary-subtle px-4 py-2"
				>
					<div>
						<span className="type-label text-tertiary-foreground">
							{checkpoint.Date}
						</span>
						<span className="ml-2 type-caption text-tertiary-foreground/80">
							{checkpoint.AccountId}
						</span>
						<span className="ml-2 type-caption text-tertiary-foreground/80">
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
