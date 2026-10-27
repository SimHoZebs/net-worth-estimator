import type { Account } from "../domain/model.ts";
import { AccountLabel } from "./AccountIcon.tsx";
import { mergeStyles } from "./mergeStyles.ts";

// Shared account press-toggle. Safe-spending uses the default sizing;
// denser lists pass their own layout classes, which win on conflict.
export function AccountToggle({
	account,
	checked,
	disabled = false,
	onToggle,
	className,
}: {
	account: Pick<Account, "id" | "kind" | "color" | "name">;
	checked: boolean;
	disabled?: boolean;
	onToggle: () => void;
	className?: string;
}) {
	return (
		<button
			type="button"
			className={mergeStyles(
				"group cursor-pointer rounded-control border border-line-strong bg-surface py-2 pr-3 pl-2 text-left text-xs transition-[border-color,background] duration-150 hover:bg-hover aria-pressed:border-primary aria-pressed:bg-success-bg motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			aria-pressed={checked}
			disabled={disabled}
			onClick={onToggle}
		>
			<AccountLabel
				account={account}
				nameClassName="group-aria-[pressed=false]:text-muted"
			/>
		</button>
	);
}
