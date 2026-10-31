import type { TexturePattern } from "./texture.ts";

export interface TextureEntry {
	/** Pattern element id, referenced as `url(#id)`. */
	id: string;
	/** Base fill (any CSS color, including `var()`), or null for transparent. */
	background: string | null;
	/** Motif color (any CSS color, including `var()`). */
	mark: string;
	/** Motif opacity, mirroring the matching CSS texture. */
	markOpacity: number;
	motif: Exclude<TexturePattern, "solid">;
	/** Tile size in user units. Defaults to 8, matching texture.css. */
	size?: number;
	/** Motif stroke width or dot diameter. Defaults to 2, matching texture.css. */
	width?: number;
}

function Motif({ entry }: { entry: TextureEntry }) {
	const size = entry.size ?? 8;
	const width = entry.width ?? 2;
	const style =
		entry.motif === "dots"
			? { fill: entry.mark, fillOpacity: entry.markOpacity }
			: { stroke: entry.mark, strokeOpacity: entry.markOpacity };
	if (entry.motif === "dots") {
		return <circle cx={size / 4} cy={size / 4} r={width} style={style} />;
	}
	if (entry.motif === "hatch") {
		return (
			<>
				<line
					x1="0"
					y1={size}
					x2={size}
					y2="0"
					strokeWidth={width}
					style={style}
				/>
				<line
					x1="0"
					y1="0"
					x2={size}
					y2={size}
					strokeWidth={width}
					style={style}
				/>
			</>
		);
	}
	return (
		<line x1="0" y1="0" x2="0" y2={size} strokeWidth={width} style={style} />
	);
}

/**
 * Pattern definitions for inline SVG charts. Entries pair a background
 * with one shared motif geometry (stripes, dots, hatch), so every chart
 * textures meaning the same way. Place inside the chart's own `<svg>`.
 */
export function TextureDefs({ entries }: { entries: TextureEntry[] }) {
	return (
		<defs>
			{entries.map((entry) => {
				const size = entry.size ?? 8;
				return (
					<pattern
						key={entry.id}
						id={entry.id}
						width={size}
						height={size}
						patternUnits="userSpaceOnUse"
						{...(entry.motif === "stripes"
							? { patternTransform: "rotate(45)" }
							: {})}
					>
						{entry.background !== null && (
							<rect
								width={size}
								height={size}
								style={{ fill: entry.background }}
							/>
						)}
						<Motif entry={entry} />
					</pattern>
				);
			})}
		</defs>
	);
}
