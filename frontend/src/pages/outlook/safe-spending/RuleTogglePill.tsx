import { exactMoney } from "../../../domain/format.ts";

/**
 * One-line detail shared by income sources and included bills:
 * `frequency · amount`. Both lists render through RuleTogglePill with
 * different data.
 */
export function formatRuleDetail({
	frequency,
	amount,
}: {
	frequency: string;
	amount: number;
}): string {
	return `${frequency} · ${exactMoney(amount)}`;
}

// Identity layout stays separate from the toggle button, mirroring
// AccountLabel next to AccountToggle.
function RuleToggleLabel({ name, detail }: { name: string; detail: string }) {
	return (
		<span className="flex min-w-0 flex-col gap-1">
			<strong className="group-aria-[pressed=false]:text-muted">{name}</strong>
			<small className="text-xs text-muted">{detail}</small>
		</span>
	);
}

export function RuleTogglePill({
	name,
	detail,
	checked,
	onToggle,
}: {
	name: string;
	detail: string;
	checked: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={checked}
			onClick={onToggle}
			className="group cursor-pointer rounded-control border border-line-strong bg-surface px-3 py-2 text-left text-xs transition-[border-color,background] duration-150 hover:bg-hover aria-pressed:border-primary aria-pressed:bg-success-bg motion-reduce:transition-none"
		>
			<RuleToggleLabel name={name} detail={detail} />
		</button>
	);
}
