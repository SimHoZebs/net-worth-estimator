import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * Shared presentational primitives. Composes the existing Card shell;
 * typography overrides replace (not merge) so custom `type-*` classes
 * never compete with the defaults.
 */

export type MetricSize = "md" | "sm";

interface MetricProps {
	label: string;
	value: ReactNode;
	detail?: ReactNode;
	capitalize?: boolean;
	size?: MetricSize;
	trailing?: ReactNode;
	ariaLabel?: string;
	className?: string;
	labelClassName?: string;
	valueClassName?: string;
	detailClassName?: string;
}

export function Metric({
	label,
	value,
	detail,
	capitalize = false,
	size = "md",
	trailing,
	ariaLabel,
	className,
	labelClassName,
	valueClassName,
	detailClassName,
}: MetricProps) {
	const body = (
		<>
			<div
				className={
					labelClassName ?? (size === "sm" ? "type-caption" : "type-label")
				}
			>
				{label}
			</div>
			<div
				className={
					valueClassName ??
					cn(
						size === "sm"
							? "mt-1 break-words type-value"
							: "mt-1 type-metric text-foreground",
						capitalize && "capitalize",
					)
				}
			>
				{value}
			</div>
			{detail ? (
				<div className={detailClassName ?? "type-muted"}>{detail}</div>
			) : null}
		</>
	);
	return (
		<div
			{...(ariaLabel ? { role: "region", "aria-label": ariaLabel } : {})}
			className={cn(
				size === "sm"
					? "rounded-xl border border-border/70 bg-surface/60 p-3"
					: "rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55",
				className,
			)}
		>
			{trailing ? (
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">{body}</div>
					{trailing}
				</div>
			) : (
				body
			)}
		</div>
	);
}

export type PillTone = "neutral" | "primary" | "tertiary" | "destructive";
export type PillSize = "md" | "xs";

/** Dashed-border placeholder for empty content. */
export function EmptyState({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"rounded-2xl border border-dashed border-border/80 p-5 type-muted",
				className,
			)}
		>
			{children}
		</div>
	);
}

export function Pill({
	tone = "neutral",
	size = "md",
	textClassName,
	className,
	children,
}: {
	tone?: PillTone;
	size?: PillSize;
	textClassName?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<span
			className={cn(
				"shrink-0 rounded-full border uppercase",
				size === "xs" ? "px-2 py-0.5" : "px-3 py-1",
				textClassName ??
					(size === "xs" ? "tracking-[0.1em]" : "type-label tracking-[0.12em]"),
				tone === "primary"
					? "border-primary-border bg-primary-subtle text-primary"
					: tone === "tertiary"
						? "border-tertiary-border bg-tertiary-subtle text-tertiary-foreground"
						: tone === "destructive"
							? "border-destructive/25 bg-destructive-subtle text-destructive-foreground"
							: "border-border/70",
				className,
			)}
		>
			{children}
		</span>
	);
}

export type PageHeaderLevel = "h1" | "h2" | "h3";

interface PageHeaderProps {
	eyebrow?: ReactNode;
	title: ReactNode;
	description?: ReactNode;
	level?: PageHeaderLevel;
	actions?: ReactNode;
	splitAt?: "sm" | "lg";
	stacked?: boolean;
	/** Opt into screen-reader-only title text. Titles are visible by default. */
	visuallyHiddenTitle?: boolean;
	className?: string;
	eyebrowClassName?: string;
	titleClassName?: string;
	descriptionClassName?: string;
}

export function PageHeader({
	eyebrow,
	title,
	description,
	level = "h1",
	actions,
	splitAt = "sm",
	stacked = false,
	visuallyHiddenTitle = false,
	className,
	eyebrowClassName,
	titleClassName,
	descriptionClassName,
}: PageHeaderProps) {
	const Title = level;
	const resolvedTitleClassName =
		titleClassName ??
		(visuallyHiddenTitle
			? "sr-only"
			: level === "h1"
				? "mt-1 type-title text-3xl"
				: level === "h2"
					? "mt-1 type-title text-2xl"
					: "mt-1 type-title text-xl");
	const text = (
		<div className="min-w-0">
			{eyebrow ? (
				<div className={eyebrowClassName ?? "type-eyebrow text-primary"}>
					{eyebrow}
				</div>
			) : null}
			<Title className={resolvedTitleClassName}>{title}</Title>
			{description ? (
				<p className={descriptionClassName ?? "mt-1 max-w-2xl type-muted"}>
					{description}
				</p>
			) : null}
		</div>
	);
	if (!actions && !className && !stacked) return text;
	return (
		<div
			className={cn(
				"min-w-0",
				actions &&
					!stacked &&
					(splitAt === "lg"
						? "flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
						: "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"),
				className,
			)}
		>
			{text}
			{actions ? (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			) : null}
		</div>
	);
}

interface SectionCardProps {
	eyebrow?: ReactNode;
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	header?: ReactNode;
	className?: string;
	headerClassName?: string;
	contentClassName?: string;
	eyebrowClassName?: string;
	titleClassName?: string;
	descriptionClassName?: string;
	children: ReactNode;
}

export function SectionCard({
	eyebrow,
	title,
	description,
	action,
	header,
	className,
	headerClassName,
	contentClassName,
	eyebrowClassName,
	titleClassName,
	descriptionClassName,
	children,
}: SectionCardProps) {
	const showHeader =
		header !== undefined ||
		eyebrow !== undefined ||
		title !== undefined ||
		description !== undefined ||
		action !== undefined;
	const titleBlock = (
		<div className="min-w-0">
			{eyebrow ? (
				<div className={cn("type-eyebrow text-primary", eyebrowClassName)}>
					{eyebrow}
				</div>
			) : null}
			{title ? <CardTitle className={titleClassName}>{title}</CardTitle> : null}
			{description ? (
				<CardDescription className={descriptionClassName}>
					{description}
				</CardDescription>
			) : null}
		</div>
	);
	return (
		<Card className={className}>
			{showHeader ? (
				<CardHeader className={headerClassName}>
					{header ??
						(action ? (
							<div className="flex flex-wrap items-start justify-between gap-3">
								{titleBlock}
								<div className="shrink-0">{action}</div>
							</div>
						) : (
							titleBlock
						))}
				</CardHeader>
			) : null}
			<CardContent className={contentClassName}>{children}</CardContent>
		</Card>
	);
}
