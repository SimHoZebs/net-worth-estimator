import { Toggle } from "@/components/ui/toggle.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils.ts";
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
	disabled = false,
	dirty = false,
	onToggle,
}: {
	name: string;
	detail: string;
	checked: boolean;
	disabled?: boolean;
	dirty?: boolean;
	onToggle: () => void;
}) {
	return (
		<Toggle
			pressed={checked}
			onPressedChange={() => onToggle()}
			disabled={disabled}
			variant="outline"
			size="lg"
			className={cn(
				"h-auto justify-start px-3 py-2 text-left text-xs",
				dirty &&
					"border-warning-border bg-warning-bg hover:bg-warning-bg data-[state=on]:bg-warning-bg",
			)}
		>
			<TogglePillLabel name={name} detail={detail} />
			{dirty && (
				<Badge
					variant="outline"
					className="ml-auto self-start mt-0.5 border-warning-border bg-warning-bg text-warning-text"
				>
					Unsaved
				</Badge>
			)}
		</Toggle>
	);
}
