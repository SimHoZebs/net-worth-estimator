/**
 * Shared texture contract: color is never the sole carrier of meaning.
 * Every series pairs a tone (color) with a pattern (texture) so filled
 * areas stay distinguishable without color vision. HTML bars consume the
 * pairing through `data-tone`/`data-pattern` attributes (texture.css);
 * charts that need patterned SVG areas pair `seriesTexture` with pattern
 * definitions from TextureDefs.
 */

export const TEXTURE_PATTERNS = ["solid", "stripes", "dots", "hatch"] as const;
export type TexturePattern = (typeof TEXTURE_PATTERNS)[number];

export const TEXTURE_TONES = ["sage", "tan", "blue", "plum"] as const;
export type TextureTone = (typeof TEXTURE_TONES)[number];

/** Tone to chart token, mirroring the SegmentedBar tone classes. */
const TONE_TOKENS: Record<TextureTone, string> = {
	sage: "var(--chart-series-1)",
	tan: "var(--chart-series-2)",
	blue: "var(--chart-series-3)",
	plum: "var(--chart-series-4)",
};

/** Tone to background utility for HTML swatches and segments. */
export const TONE_BACKGROUNDS: Record<TextureTone, string> = {
	sage: "bg-chart-series-1",
	tan: "bg-chart-series-2",
	blue: "bg-chart-series-3",
	plum: "bg-chart-series-4",
};

export function toneToken(tone: TextureTone): string {
	return TONE_TOKENS[tone];
}

/**
 * Stable series assignment: tones cycle fastest so the first four series
 * stay solid in tone order; patterns change every four series, giving 16
 * distinct tone-plus-pattern combinations before any repeat.
 */
export function seriesTexture(index: number): {
	tone: TextureTone;
	pattern: TexturePattern;
} {
	return {
		tone: TEXTURE_TONES[index % TEXTURE_TONES.length]!,
		pattern:
			TEXTURE_PATTERNS[
				(index + Math.floor(index / TEXTURE_TONES.length)) %
					TEXTURE_PATTERNS.length
			]!,
	};
}
