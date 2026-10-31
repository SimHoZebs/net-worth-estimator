import { TextureDefs, type TextureEntry } from "./TextureDefs.tsx";
import {
	TEXTURE_PATTERNS,
	TEXTURE_TONES,
	textureId,
	toneToken,
	type TexturePattern,
	type TextureTone,
} from "./texture.ts";

function spriteMark(
	tone: TextureTone,
	pattern: TexturePattern,
): {
	mark: string;
	markOpacity: number;
} {
	// Mirror texture.css motifs at softened intensity: the sprite fills
	// large chart areas where bar-strength texture would shout. Dots on
	// blue and plum darken the tone instead, as in texture.css.
	if (pattern === "dots" && (tone === "blue" || tone === "plum")) {
		return {
			mark: `color-mix(in oklab, ${toneToken(tone)} 12%, var(--color-black))`,
			markOpacity: 1,
		};
	}
	return {
		mark: "var(--color-white)",
		markOpacity: pattern === "dots" ? 0.15 : pattern === "hatch" ? 0.3 : 0.22,
	};
}

const ENTRIES: TextureEntry[] = TEXTURE_TONES.flatMap((tone) =>
	TEXTURE_PATTERNS.filter(
		(pattern): pattern is Exclude<TexturePattern, "solid"> =>
			pattern !== "solid",
	).map((pattern) => {
		const { mark, markOpacity } = spriteMark(tone, pattern);
		return {
			id: textureId(tone, pattern),
			background: toneToken(tone),
			mark,
			markOpacity,
			motif: pattern,
		};
	}),
);

/**
 * Document-wide pattern sprite for charts that cannot host their own
 * defs (TanStack renders its own SVG). Fills reference these ids through
 * `textureFill`. Single owner: ContributionStackPlot renders this once;
 * a second textured TanStack chart should hoist it to shared chrome.
 */
export function TextureSprite() {
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			style={{
				position: "absolute",
				width: 0,
				height: 0,
				overflow: "hidden",
			}}
		>
			<TextureDefs entries={ENTRIES} />
		</svg>
	);
}
