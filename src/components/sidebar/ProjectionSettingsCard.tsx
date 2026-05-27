import { memo, useState } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatCurrencyInput, formatDate } from "@/lib/format";
import type { ProjectionRuntimeSettings } from "@/lib/projection";

interface ProjectionSettingsCardProps {
	projectionSettings: ProjectionRuntimeSettings;
	projectionStartDate: string;
	activeOverrideCount: number;
	onTargetNetWorthChange: (value: number) => void;
	onProjectionSettingsChange?: (
		partial: Partial<ProjectionRuntimeSettings>,
	) => void;
}

export const ProjectionSettingsCard = memo(function ProjectionSettingsCard({
	projectionSettings,
	projectionStartDate,
	activeOverrideCount,
	onTargetNetWorthChange,
	onProjectionSettingsChange,
}: ProjectionSettingsCardProps) {
	const [isTargetFocused, setIsTargetFocused] = useState(false);
	const [targetDraft, setTargetDraft] = useState(
		String(projectionSettings.targetNetWorth),
	);

	const commitTargetNetWorth = () => {
		const nextTarget = Number(targetDraft);
		if (Number.isFinite(nextTarget)) {
			onTargetNetWorthChange(nextTarget);
		}
		setIsTargetFocused(false);
	};

	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Projection settings</CardTitle>
				<CardDescription>
					Session-only controls for the current projection.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
					<div className="type-eyebrow">Target net worth</div>
					{isTargetFocused ? (
						<input
							type="number"
							inputMode="numeric"
							step={1000}
							value={targetDraft}
							onChange={(event) => setTargetDraft(event.currentTarget.value)}
							onBlur={commitTargetNetWorth}
							onKeyDown={(event) => {
								if (event.key === "Enter") commitTargetNetWorth();
								if (event.key === "Escape") {
									setTargetDraft(String(projectionSettings.targetNetWorth));
									setIsTargetFocused(false);
								}
							}}
							className="mt-2 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 type-title shadow-sm outline-none transition focus:border-ring dark:border-white/10"
						/>
					) : (
						<button
							type="button"
							onClick={() => {
								setTargetDraft(String(projectionSettings.targetNetWorth));
								setIsTargetFocused(true);
							}}
							className="mt-2 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-left type-title shadow-sm outline-none transition hover:border-ring focus:border-ring dark:border-white/10"
						>
							{formatCurrencyInput(String(projectionSettings.targetNetWorth))}
						</button>
					)}
					<div className="mt-1 type-caption text-muted-foreground/70">
						Nominal dollars
					</div>
				</div>

				<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
					<div className="flex items-center justify-between">
						<div className="type-eyebrow">Horizon</div>
						<span className="type-title">
							{projectionSettings.horizonYears} yr
						</span>
					</div>
					<input
						type="range"
						min={5}
						max={50}
						step={1}
						value={projectionSettings.horizonYears}
						onChange={(event) =>
							onProjectionSettingsChange?.({
								horizonYears: Number(event.target.value),
							})
						}
						className="mt-2 w-full accent-primary"
					/>
					<div className="mt-1 type-caption text-muted-foreground/70">
						From {formatDate(projectionStartDate)}
					</div>
				</div>

				<div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card/85 px-4 py-3 dark:border-white/10">
					<div>
						<div className="type-eyebrow">Overrides</div>
						<div className="mt-0.5 type-caption text-muted-foreground/70">
							{activeOverrideCount === 0
								? "Baseline only"
								: "Temporary scenario changes"}
						</div>
					</div>
					<div className="type-title">
						{activeOverrideCount === 0 ? "None" : activeOverrideCount}
					</div>
				</div>
			</CardContent>
		</Card>
	);
});
