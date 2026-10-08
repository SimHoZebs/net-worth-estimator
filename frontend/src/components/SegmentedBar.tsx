import { money } from "../domain/format.ts";

/**
 * Fill texture for a bar segment. Texture carries the meaning alongside
 * color (never color alone): bills read as stripes, reserves as dots,
 * warnings as crosshatch everywhere this bar is used.
 */
export type SegmentPattern = "solid" | "stripes" | "dots" | "hatch";

export type SegmentTone = "sage" | "pale" | "dark" | "amber";

export interface BarSegment {
	label: string;
	amount: number;
	pattern: SegmentPattern;
	tone: SegmentTone;
}

/** A stacked bar splitting one pool of money into labeled segments. */
export function SegmentedBar({
	caption,
	segments,
	ariaLabel,
}: {
	caption: string;
	segments: BarSegment[];
	ariaLabel: string;
}) {
	const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
	return (
		<div>
			<p className="section-note">{caption}</p>
			<div className="seg-bar" role="img" aria-label={ariaLabel}>
				{segments.map((segment) =>
					segment.amount > 0 ? (
						<span
							key={segment.label}
							className={`seg seg-${segment.tone} pat-${segment.pattern}`}
							style={{
								width: `${(segment.amount / Math.max(total, 1)) * 100}%`,
							}}
						/>
					) : null,
				)}
			</div>
			<ul className="seg-legend">
				{segments.map((segment) => (
					<li key={segment.label}>
						<span
							className={`seg-swatch seg-${segment.tone} pat-${segment.pattern}`}
							aria-hidden="true"
						/>
						{segment.label} · {money(segment.amount)}
					</li>
				))}
			</ul>
		</div>
	);
}
