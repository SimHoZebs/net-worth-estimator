import { Toggle } from "@/components/ui/toggle.tsx";
import { exactMoney } from "../../../domain/format.ts";

/**
 * One-line detail shared by income sources and included bills: the amount.
 * Both lists render through TogglePill with different data.
 */
export function formatRuleDetail({ amount }: { amount: number }): string {
	return exactMoney(amount);
}

function TogglePillLabel({ name, detail }: { name: string; detail: string }) {
	return (
		<span className="flex min-w-0 flex-col items-start gap-1">
			<strong>{name}</strong>
			<small className="text-xs text-muted-foreground">{detail}</small>
		</span>
	);
}

export function TogglePill({
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
		<Toggle
			pressed={checked}
			onPressedChange={() => onToggle()}
			variant="outline"
			size="lg"
			className="h-auto justify-start px-3 py-2 text-left text-xs"
		>
			<TogglePillLabel name={name} detail={detail} />
		</Toggle>
	);
}
