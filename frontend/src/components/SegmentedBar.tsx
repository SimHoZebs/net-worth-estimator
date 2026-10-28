import { money } from "../domain/format.ts";
import { cssVariables } from "./cssVariables.ts";
import { mergeStyles } from "./mergeStyles.ts";
import "./SegmentedBar.css";

/**
 * Fill texture for a bar segment. Texture carries the meaning alongside
 * color (never color alone): bills read as stripes, reserves as dots,
 * warnings as crosshatch everywhere this bar is used.
 */
export type SegmentPattern = "solid" | "stripes" | "dots" | "hatch";

/** Sage is the single green tone, so adjacent segments stay distinct. */
export type SegmentTone = "sage" | "tan" | "blue" | "plum";

const toneClasses: Record<SegmentTone, string> = {
	sage: "bg-chart-series-1",
	tan: "bg-chart-series-2",
	blue: "bg-chart-series-3",
	plum: "bg-chart-series-4",
};

export interface BarSegment {
	label: string;
	amount: number;
	pattern: SegmentPattern;
	tone: SegmentTone;
}

/** A stacked bar splitting one pool of money into labeled segments.
 * Only positive shares are drawn: a negative remainder is not a share of
 * the pool, so callers omit it and state it in the caption instead. */
export function SegmentedBar({
	caption,
	segments,
	ariaLabel,
	showDetails = true,
	className,
	captionClassName,
	showAmounts = true,
}: {
	caption: string;
	segments: BarSegment[];
	ariaLabel: string;
	showDetails?: boolean;
	className?: string;
	captionClassName?: string;
	showAmounts?: boolean;
}) {
	const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
	// oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled flex lists.
	return (
		<div className={mergeStyles("grid gap-2", className)}>
			{showDetails && (
				<p
					className={mergeStyles(
						"m-0 text-sm leading-relaxed text-muted",
						captionClassName,
					)}
				>
					{caption}
				</p>
			)}
			<div
				className="m-0 flex h-3.5 overflow-hidden rounded-control bg-surface-3"
				role="img"
				aria-label={ariaLabel}
			>
				{segments.map((segment) =>
					segment.amount > 0 ? (
						<span
							key={segment.label}
							className={mergeStyles(
								"block h-full min-w-1 w-(--segment-width) not-first:border-l-2 not-first:border-surface",
								toneClasses[segment.tone],
							)}
							data-tone={segment.tone}
							data-pattern={segment.pattern}
							style={cssVariables({
								"--segment-width": `${(segment.amount / Math.max(total, 1)) * 100}%`,
							})}
						/>
					) : null,
				)}
			</div>
			{showDetails && (
				<ul
					className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-xs text-muted"
					role="list"
					aria-label={`${caption} details`}
				>
					{segments.map((segment) => (
						<li key={segment.label} className="flex items-center gap-2">
							<span
								className={mergeStyles(
									"inline-block h-2.5 w-3.5 flex-none rounded-control",
									toneClasses[segment.tone],
								)}
								data-tone={segment.tone}
								data-pattern={segment.pattern}
								aria-hidden="true"
							/>
							{segment.label}
							{showAmounts && ` · ${money(segment.amount)}`}
						</li>
					))}
				</ul>
			)}
		</div>
	);
	// oxlint-enable jsx-a11y/no-redundant-roles
}
