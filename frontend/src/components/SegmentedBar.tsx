import { money } from "../domain/format.ts";
import { cssVariables } from "./cssVariables.ts";
import { cn } from "@/lib/utils.ts";
import {
	TONE_BACKGROUNDS,
	type TexturePattern,
	type TextureTone,
} from "./texture/texture.ts";
import "./texture/texture.css";

/**
 * Fill texture for a bar segment. Texture carries the meaning alongside
 * color (never color alone): bills read as stripes, reserves as dots,
 * warnings as crosshatch everywhere this bar is used.
 */
export type SegmentPattern = TexturePattern;

/** Sage is the single green tone, so adjacent segments stay distinct. */
export type SegmentTone = TextureTone;

const toneClasses: Record<SegmentTone, string> = TONE_BACKGROUNDS;

export interface BarSegment {
	label: string;
	amount: number;
	pattern: SegmentPattern;
	tone: SegmentTone;
	testId?: string;
}

/** A marker at a cumulative point inside the pool, labelled in the legend.
 * The caller owns the wording; the bar only draws the line at that share. */
export interface BarBoundary {
	amount: number;
	label: string;
	testId?: string;
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
	formatAmount = money,
	boundary,
}: {
	caption: string;
	segments: BarSegment[];
	ariaLabel: string;
	showDetails?: boolean;
	className?: string;
	captionClassName?: string;
	showAmounts?: boolean;
	formatAmount?: (value: number) => string;
	boundary?: BarBoundary;
}) {
	const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
	// Compare in integer cents: float segment widths can sum marginally below
	// a cent-exact boundary (e.g. 12.2 + 1.35), which must not drop the marker.
	const showBoundary =
		boundary != null &&
		Math.round(boundary.amount * 100) > 0 &&
		Math.round(boundary.amount * 100) <= Math.round(total * 100);
	// oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled flex lists.
	return (
		<div className={cn("grid gap-2", className)}>
			{showDetails && (
				<p
					className={cn(
						"m-0 text-sm leading-relaxed text-muted-foreground",
						captionClassName,
					)}
				>
					{caption}
				</p>
			)}
			<div
				className="m-0 relative flex h-3.5 overflow-hidden rounded-md bg-accent"
				role="img"
				aria-label={ariaLabel}
			>
				{segments.map((segment) =>
					segment.amount > 0 ? (
						<span
							key={segment.label}
							className={cn(
								"block h-full min-w-1 w-(--segment-width) not-first:border-l-2 not-first:border-card",
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
				{showBoundary && (
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-card"
						data-boundary-marker="true"
						style={{ left: `${(boundary!.amount / total) * 100}%` }}
					/>
				)}
			</div>
			{showDetails && (
				<ul
					className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 text-xs text-muted-foreground"
					role="list"
					aria-label={`${caption} details`}
				>
					{segments.map((segment) => (
						<li
							key={segment.label}
							className="flex items-center gap-2"
							data-testid={segment.testId}
						>
							<span
								className={cn(
									"inline-block h-2.5 w-3.5 flex-none rounded-md",
									toneClasses[segment.tone],
								)}
								data-tone={segment.tone}
								data-pattern={segment.pattern}
								aria-hidden="true"
							/>
							{segment.label}
							{showAmounts && ` · ${formatAmount(segment.amount)}`}
						</li>
					))}
					{showBoundary && (
						<li
							className="flex items-center gap-2"
							data-testid={boundary!.testId}
						>
							<span
								aria-hidden="true"
								className="inline-block h-2.5 w-0.5 flex-none rounded-sm bg-foreground"
							/>
							{boundary!.label}
							{showAmounts && ` · ${formatAmount(boundary!.amount)}`}
						</li>
					)}
				</ul>
			)}
		</div>
	);
	// oxlint-enable jsx-a11y/no-redundant-roles
}
