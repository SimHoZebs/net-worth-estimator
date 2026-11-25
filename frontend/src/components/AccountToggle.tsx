import type { Account } from "../domain/model.ts";
import { AccountLabel } from "./AccountIcon.tsx";
import { Toggle } from "@/components/ui/toggle.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils.ts";

// Shared account press-toggle on the canonical toggle primitive. The
// primitive owns pressed, hover, disabled, and focus visuals; the only
// caller override is layout for the rich account identity content.
// Safe-spending uses the default sizing; denser lists pass their own layout
// classes, which win on conflict.
export function AccountToggle({
	account,
	checked,
	disabled = false,
	dirty = false,
	onToggle,
	className,
}: {
	account: Pick<Account, "id" | "kind" | "color" | "name">;
	checked: boolean;
	disabled?: boolean;
	dirty?: boolean;
	onToggle: () => void;
	className?: string;
}) {
	return (
		<Toggle
			pressed={checked}
			onPressedChange={() => onToggle()}
			disabled={disabled}
			variant="outline"
			className={cn(
				"h-auto min-h-9 w-full min-w-0 justify-start gap-3 px-2 py-2 text-left text-xs",
				dirty &&
					"border-warning-border bg-warning-bg hover:bg-warning-bg data-[state=on]:bg-warning-bg",
				className,
			)}
		>
			<AccountLabel account={account} />
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
