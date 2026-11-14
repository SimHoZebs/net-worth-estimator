import type { FinancialIndependenceRange } from "@/domain/financialIndependence.ts";
import { dateLabel, percent } from "@/domain/format.ts";
import { cssVariables } from "@/components/cssVariables.ts";

export function IndependenceRange({
	range,
	required,
	compact = false,
}: {
	range: FinancialIndependenceRange | null;
	required: number | null;
	compact?: boolean;
}) {
	if (!range || range.probability === null)
		return (
			<p className="m-0 text-xs text-muted-foreground">
				Scenarios · Not calculated
			</p>
		);
	const probability = range.probability;
	if (compact)
		return (
			<p className="m-0 text-xs text-muted-foreground">
				Scenarios ·{" "}
				<strong className="type-value text-foreground">
					{percent(probability)}
				</strong>{" "}
				reached independence
				{required === null ? "" : ` · ${percent(required)} required`}
			</p>
		);
	return (
		<div className="grid gap-2 border-t border-border pt-3">
			<div className="flex flex-wrap justify-between gap-2 text-xs">
				<span>
					<strong className="type-value">{percent(probability)}</strong> reached
					independence
				</span>
				<span className="text-muted-foreground">
					{required === null
						? "Confidence target unavailable"
						: `${percent(required)} required`}{" "}
					· {range.count} scenarios
				</span>
			</div>
			<div
				role="img"
				aria-label={`Financial independence reached within the testable horizon in ${percent(probability)} of ${range.count} modeled scenarios.${required === null ? "" : ` Required confidence: ${percent(required)}.`}`}
				className="relative h-5"
			>
				<div
					className="absolute inset-x-1 top-1/2 h-1.5 -translate-y-1/2 overflow-visible rounded-full bg-accent"
					style={cssVariables({
						"--probability": `${probability * 100}%`,
						"--required": required === null ? "0%" : `${required * 100}%`,
					})}
				>
					<div className="h-full w-(--probability) rounded-full bg-primary" />
					{required !== null && (
						<span className="absolute -inset-y-2 left-(--required) w-0.5 bg-foreground" />
					)}
					<span className="absolute top-1/2 left-(--probability) size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card" />
				</div>
			</div>
			{range.date && (
				<p className="m-0 text-xs text-muted-foreground">
					Required confidence first reached ·{" "}
					<strong className="type-value text-foreground">
						{dateLabel(range.date)}
					</strong>
					{range.dateProbability === null
						? ""
						: ` · ${percent(range.dateProbability)}`}
				</p>
			)}
		</div>
	);
}
