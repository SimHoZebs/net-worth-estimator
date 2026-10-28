import { useId } from "react";
import type { FinancialIndependenceRange } from "@/domain/financialIndependence.ts";
import { dateLabel, percent } from "@/domain/format.ts";

export function IndependenceRange({
	range,
	required,
	compact = false,
}: {
	range: FinancialIndependenceRange | null;
	required: number | null;
	compact?: boolean;
}) {
	const id = useId();
	if (!range || range.probability === null)
		return <p className="m-0 text-xs text-muted">Scenarios · Not calculated</p>;
	const probability = range.probability;
	if (compact)
		return (
			<p className="m-0 text-xs text-muted">
				Scenarios ·{" "}
				<strong className="type-value text-ink">{percent(probability)}</strong>{" "}
				reached independence
				{required === null ? "" : ` · ${percent(required)} required`}
			</p>
		);
	return (
		<div className="grid gap-2 border-t border-line pt-3">
			<div className="flex flex-wrap justify-between gap-2 text-xs">
				<span>
					<strong className="type-value">{percent(probability)}</strong> reached
					independence
				</span>
				<span className="text-muted">
					{required === null
						? "Confidence target unavailable"
						: `${percent(required)} required`}{" "}
					· {range.count} scenarios
				</span>
			</div>
			<svg
				viewBox="0 0 400 18"
				className="block h-5 w-full overflow-visible"
				role="img"
				aria-labelledby={id}
			>
				<title id={id}>
					Financial independence reached within the testable horizon in{" "}
					{percent(probability)} of {range.count} modeled scenarios.
					{required === null
						? ""
						: ` Required confidence: ${percent(required)}.`}
				</title>
				<rect
					x="4"
					y="6"
					width="392"
					height="6"
					rx="3"
					className="fill-surface-3"
				/>
				<rect
					x="4"
					y="6"
					width={392 * probability}
					height="6"
					rx="3"
					className="fill-primary"
				/>
				{required !== null && (
					<line
						x1={4 + 392 * required}
						x2={4 + 392 * required}
						y1="0"
						y2="18"
						className="stroke-ink"
						strokeWidth="2"
					/>
				)}
				<circle
					cx={4 + 392 * probability}
					cy="9"
					r="4"
					className="fill-primary stroke-surface"
					strokeWidth="2"
				/>
			</svg>
			{range.date && (
				<p className="m-0 text-xs text-muted">
					Required confidence first reached ·{" "}
					<strong className="type-value text-ink">
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
