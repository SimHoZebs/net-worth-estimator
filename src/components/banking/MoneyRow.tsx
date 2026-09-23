import { DateText } from "@/components/dashboard/tables/primitives/formatting";
import { currency, formatFrequency } from "@/lib/format";
import {
	isNumericArithmetic,
	parseNumericArithmetic,
} from "@/lib/posting-categories";
import type { Account, Posting } from "@/lib/projection";
import { describePostingAmount, getExpression } from "@/lib/projection";
import { moneyDirection } from "./money";

function initials(label: string): string {
	const words = label.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return "?";
	if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
	return (words[0][0] + words[1][0]).toUpperCase();
}

export function MoneyAvatar({
	label,
	color,
	direction,
}: {
	label: string;
	color?: string | null;
	direction: ReturnType<typeof moneyDirection>;
}) {
	return (
		<span
			aria-hidden="true"
			className="flex size-10 shrink-0 items-center justify-center rounded-full type-value text-sm text-white"
			style={{ backgroundColor: color ?? "#64748b" }}
		>
			{direction === "in" ? "↓" : direction === "out" ? "↑" : initials(label)}
		</span>
	);
}

export function MoneyAmountText({ posting }: { posting: Posting }) {
	const direction = moneyDirection(posting);
	const tone =
		direction === "in"
			? "text-[color:var(--chart-success)]"
			: direction === "out"
				? "text-destructive"
				: "text-foreground";
	const prefix = direction === "in" ? "+" : direction === "out" ? "−" : "";
	const expression = getExpression(posting);
	if (expression !== null && isNumericArithmetic(expression)) {
		const amount = parseNumericArithmetic(expression);
		if (amount <= 0)
			return (
				<span className="text-muted-foreground">{currency.format(0)}</span>
			);
		return (
			<span className={`tabular-nums ${tone}`}>
				{prefix}
				{currency.format(Math.abs(amount))}
			</span>
		);
	}
	return (
		<span className={`break-all ${tone}`}>
			{prefix}
			{describePostingAmount(posting)}
		</span>
	);
}

export function MoneyRow({
	posting,
	accountById,
	onOpen,
	showDate = false,
}: {
	posting: Posting;
	accountById: ReadonlyMap<string, Account>;
	onOpen: (posting: Posting) => void;
	showDate?: boolean;
}) {
	const direction = moneyDirection(posting);
	const source = posting.sourceAccountId
		? accountById.get(posting.sourceAccountId)
		: null;
	const firstDestination =
		posting.destinations?.[0] !== undefined
			? accountById.get(posting.destinations[0])
			: null;
	const counterparty =
		direction === "in"
			? (firstDestination?.label ?? "External")
			: (source?.label ?? "External");
	const avatarColor =
		direction === "in"
			? firstDestination?.color
			: (source?.color ?? firstDestination?.color);

	return (
		<button
			type="button"
			onClick={() => onOpen(posting)}
			className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-accent/50"
		>
			<MoneyAvatar
				label={posting.label}
				color={avatarColor}
				direction={direction}
			/>
			<span className="min-w-0 flex-1">
				<span className="block truncate type-value">{posting.label}</span>
				<span className="block truncate type-caption">
					{counterparty}
					{posting.frequency !== "once" ? (
						<>
							{" · "}
							{formatFrequency(posting.frequency)}
						</>
					) : null}
					{showDate ? (
						<>
							{" · "}
							<DateText value={posting.startDate} />
						</>
					) : null}
				</span>
			</span>
			<span className="shrink-0 type-value">
				<MoneyAmountText posting={posting} />
			</span>
		</button>
	);
}
