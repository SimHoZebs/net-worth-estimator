import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { selectCurrentChangeCount, useStore } from "@/store";

export function SimulationSettingsCard() {
	const { projectionStartDate } = useModelRuntime();
	const horizonYears = useStore((state) => state.horizonYears);
	const setHorizonYears = useStore((state) => state.setHorizonYears);
	const currentChangeCount = useStore(selectCurrentChangeCount);
	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Simulation plan</CardTitle>
				<CardDescription>
					Simulation settings shared by the base path and every evaluation.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
					<div className="flex items-center justify-between">
						<div className="type-eyebrow">Projection horizon</div>
						<span className="type-title">{horizonYears} yr</span>
					</div>
					<input
						type="range"
						aria-label="Projection horizon in years"
						min={5}
						max={50}
						step={1}
						value={horizonYears}
						onChange={(event) => setHorizonYears(Number(event.target.value))}
						className="mt-2 w-full accent-primary"
					/>
					<div className="mt-1 type-caption text-muted-foreground/70">
						From {formatDate(projectionStartDate)} · {currentChangeCount}{" "}
						temporary change{currentChangeCount === 1 ? "" : "s"}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
