import { useState } from "react";
import { LabeledField } from "@/components/fields/field-kit";
import { SectionCard } from "@/components/present/present";
import { formatDate } from "@/lib/format";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { useStore } from "@/store";

const MIN_HORIZON_YEARS = 5;
const MAX_HORIZON_YEARS = 50;

function clampHorizonYears(value: number): number {
	if (!Number.isFinite(value)) return MIN_HORIZON_YEARS;
	return Math.max(
		MIN_HORIZON_YEARS,
		Math.min(MAX_HORIZON_YEARS, Math.round(value)),
	);
}

export function SimulationSettingsCard() {
	const { projectionStartDate } = useModelRuntime();
	const horizonYears = useStore((state) => state.horizonYears);
	const setHorizonYears = useStore((state) => state.setHorizonYears);
	// Text draft for the stepper so intermediate keystrokes ("", "2" on the
	// way to "25") are preserved until blur/Enter commits a clamped value.
	const [yearsDraft, setYearsDraft] = useState<string | null>(null);

	const commitYearsDraft = (raw: string) => {
		if (raw.trim() === "") {
			setYearsDraft(null);
			return;
		}
		setHorizonYears(clampHorizonYears(Number(raw)));
		setYearsDraft(null);
	};

	return (
		<SectionCard title="Plan" className="rounded-[1.4rem] border-border/80">
			<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
				<div className="flex items-center justify-between gap-3">
					<label htmlFor="horizon-years" className="type-eyebrow">
						Horizon
					</label>
					<span className="type-title" aria-live="polite">
						{horizonYears} yr
					</span>
				</div>
				<input
					id="horizon-years"
					type="range"
					min={MIN_HORIZON_YEARS}
					max={MAX_HORIZON_YEARS}
					step={1}
					list="horizon-years-ticks"
					value={horizonYears}
					onChange={(event) => {
						setYearsDraft(null);
						setHorizonYears(Number(event.target.value));
					}}
					className="mt-2 min-h-11 w-full accent-primary"
				/>
				<datalist id="horizon-years-ticks">
					{Array.from(
						{
							length: (MAX_HORIZON_YEARS - MIN_HORIZON_YEARS) / 5 + 1,
						},
						(_, index) => (
							<option
								key={MIN_HORIZON_YEARS + index * 5}
								value={MIN_HORIZON_YEARS + index * 5}
							/>
						),
					)}
				</datalist>
				<div
					aria-hidden="true"
					className="flex justify-between type-caption text-muted-foreground/70"
				>
					<span>{MIN_HORIZON_YEARS} yr</span>
					<span>{MAX_HORIZON_YEARS} yr</span>
				</div>
				<div className="mt-3 max-w-44">
					<LabeledField
						label="Years"
						id="horizon-years-exact"
						type="text"
						inputMode="numeric"
						value={yearsDraft ?? String(horizonYears)}
						onChange={setYearsDraft}
						onBlur={() => {
							if (yearsDraft !== null) commitYearsDraft(yearsDraft);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && yearsDraft !== null) {
								event.preventDefault();
								commitYearsDraft(yearsDraft);
								event.currentTarget.blur();
							}
							if (event.key === "Escape") {
								setYearsDraft(null);
								event.currentTarget.blur();
							}
						}}
						className="min-h-11 tabular-nums"
					/>
				</div>
				<div className="mt-1 type-caption text-muted-foreground/70">
					From {formatDate(projectionStartDate)}
				</div>
			</div>
		</SectionCard>
	);
}
