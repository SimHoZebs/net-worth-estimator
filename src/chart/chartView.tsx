import type uPlot from "uplot";
import { createBaseOptions } from "./uplotBase";

export const FALLBACK_ACCOUNT_COLOR = "GrayText";

export function resolveAccountColor(color: string | null | undefined): string {
	return color ?? FALLBACK_ACCOUNT_COLOR;
}

export function AccountColorDot({
	color,
	className = "inline-block h-2.5 w-2.5 rounded-sm",
}: {
	color: string | null | undefined;
	className?: string;
}) {
	return (
		<span
			className={className}
			style={{ backgroundColor: resolveAccountColor(color) }}
		/>
	);
}

export function baseChartOptions(): Partial<uPlot.Options> & {
	width: number;
	height: number;
	legend: { show: false };
	bands: [];
} {
	const base = createBaseOptions();
	return {
		...base,
		width: 0,
		height: 0,
		legend: { show: false },
		bands: [],
	};
}

export function colorDotHtml(className = "bg-muted-foreground"): string {
	return `<span class="inline-block h-2 w-2 rounded-full ${className}"></span>`;
}

export function openChartTooltip(
	dateLabel: string,
	options?: { widthClass?: string; listClass?: string },
): string {
	const widthClass = options?.widthClass ?? "max-w-xs";
	const listClass = options?.listClass ?? "mt-1 space-y-0.5";
	let html = `<div class="${widthClass} rounded-lg border border-border/80 bg-card/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/10">`;
	html += `<div class="type-label">${dateLabel}</div>`;
	html += `<div class="${listClass}">`;
	return html;
}

export function closeChartTooltip(): string {
	return `</div></div>`;
}
