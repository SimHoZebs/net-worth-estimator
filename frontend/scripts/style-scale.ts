/** Ordinary spacing is deliberately smaller than Tailwind's sizing vocabulary. */
export const spacingSteps = [0, 0.5, 1, 2, 3, 4, 5, 6, 8, 12] as const;
const ordinarySpacing =
	/^(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|scroll-[mp][xytrblse]?|border-spacing(?:-[xy])?)$/;
const utility =
	/^(p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|[wh]|size|min-[wh]|max-[wh]|basis|indent|inset(?:-[xyse])?|top|right|bottom|left|start|end|translate(?:-[xy])?|scroll-[mp][xytrblse]?|border-spacing(?:-[xy])?)-\[(.+)\]$/;

export function spacing(
	value: string,
): { scale: string; negative: boolean } | null {
	const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)?$/i.exec(value);
	if (!match || (!match[2] && Number(match[1]) !== 0)) return null;
	const pixels =
		Number(match[1]) * (match[2]?.toLowerCase() === "rem" ? 16 : 1);
	const absolute = Math.abs(pixels);
	const rounded =
		absolute >= 4
			? Math.round(absolute / 4) * 4
			: [0, 1, 2, 4].reduce((best, next) =>
					Math.abs(next - absolute) <= Math.abs(best - absolute) ? next : best,
				);
	return {
		scale: rounded === 1 ? "px" : String(rounded / 4),
		negative: pixels < 0 && rounded !== 0,
	};
}

export function approvedSpacing(scale: string): string {
	if (scale === "px") return scale; // Hairline alignment, not an ordinary spacing step.
	const value = Number(scale);
	return String(
		spacingSteps.reduce<number>(
			(best, next) =>
				Math.abs(next - value) <= Math.abs(best - value) ? next : best,
			0,
		),
	);
}

/** Split variants only outside arbitrary selectors and function arguments. */
export function variantEnd(value: string): number {
	let depth = 0;
	let end = 0;
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character === "[" || character === "(") depth++;
		if (character === "]" || character === ")") depth--;
		if (character === ":" && depth === 0) end = index + 1;
	}
	return end;
}

export function normalizeSpacingUtility(token: string): string {
	const end = variantEnd(token);
	const prefix = token.slice(0, end);
	let base = token.slice(end);
	const importantBefore = base.startsWith("!") ? "!" : "";
	const importantAfter = base.endsWith("!") ? "!" : "";
	base = base.replace(/^!|!$/g, "");
	const wrap = (value: string) =>
		`${prefix}${importantBefore}${value}${importantAfter}`;
	const radius =
		/^(rounded(?:-[trblse]{1,2})?)(?:-(xs|sm|md|lg|xl|2xl|3xl|4xl))?$/.exec(
			base,
		);
	if (radius)
		return wrap(
			`${radius[1]}-${!radius[2] || ["xs", "sm", "md"].includes(radius[2]) ? "control" : "surface"}`,
		);
	const numeric = /^(-?)(.+)-(\d+(?:\.\d+)?|px)$/.exec(base);
	if (numeric && ordinarySpacing.test(numeric[2]!))
		return wrap(`${numeric[1]}${numeric[2]}-${approvedSpacing(numeric[3]!)}`);
	const negative = base.startsWith("-");
	if (negative) base = base.slice(1);
	const match = utility.exec(base);
	if (!match) return token;
	const name = match[1]!;
	const values = match[2]!.split("_").map(spacing);
	if (values.some((value) => value === null)) return token;
	let names = [name];
	if (values.length > 1) {
		if (["p", "m", "scroll-p", "scroll-m", "inset"].includes(name)) {
			const suffix = name === "inset" ? "-" : "";
			names =
				values.length === 2
					? [`${name}${suffix}y`, `${name}${suffix}x`]
					: values.length === 3
						? [`${name}${suffix}t`, `${name}${suffix}x`, `${name}${suffix}b`]
						: [
								`${name}${suffix}t`,
								`${name}${suffix}r`,
								`${name}${suffix}b`,
								`${name}${suffix}l`,
							];
			if (name === "inset" && values.length > 2)
				names =
					values.length === 3
						? ["top", "inset-x", "bottom"]
						: ["top", "right", "bottom", "left"];
		} else if (
			["gap", "border-spacing", "translate"].includes(name) &&
			values.length === 2
		) {
			names = name === "gap" ? ["gap-y", "gap-x"] : [`${name}-x`, `${name}-y`];
		} else return token;
	}
	if (names.length !== values.length) return token;
	return names
		.map((name, index) => {
			const value = values[index]!;
			const scale = ordinarySpacing.test(name)
				? approvedSpacing(value.scale)
				: value.scale;
			const sign = scale !== "0" && negative !== value.negative ? "-" : "";
			return wrap(`${sign}${name}-${scale}`);
		})
		.join(" ");
}

export function normalizeSpacingClasses(value: string): string {
	return value.replace(/\S+/g, normalizeSpacingUtility);
}

/** Constraints and runtime values remain open; static layout workarounds do not. */
export function sizingWarning(token: string): string | null {
	const base = token.slice(variantEnd(token)).replace(/^!|!$/g, "");
	if (
		/(?:^|:)(?:@?(?:min|max)-\[[^\]]*(?:px|rem)|\[@media\([^\]]*(?:width|height))/.test(
			token,
		)
	)
		return "Use named Tailwind viewport or container breakpoints.";
	if (
		/^rounded(?:-[trblse]{1,2})?(?:-|$)/.test(base) &&
		!/^rounded(?:-[trblse]{1,2})?-(?:control|surface|none|full|\[inherit\])$/.test(
			base,
		)
	)
		return "Use control, surface, none, full, or inherit rounding.";
	if (base.startsWith("tracking-["))
		return "Use Tailwind's named letter spacing.";
	if (
		/^(?:min-|max-)?w-(\d+(?:\.\d+)?)$/.test(base) &&
		Number(base.match(/[\d.]+$/)![0]) >= 64
	)
		return "Use a named container width for large fixed widths.";
	if (
		/^(?:grid-cols|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|(?:min-|max-)?[wh]|basis)-\[/.test(
			base,
		) &&
		/\d(?:px|rem)/.test(base) &&
		!/(?:var\(|--spacing\(|--container-|ch\b)/.test(base)
	)
		return "Use intrinsic layout, named containers, or Tailwind spacing constraints instead of literal layout arithmetic.";
	return null;
}
