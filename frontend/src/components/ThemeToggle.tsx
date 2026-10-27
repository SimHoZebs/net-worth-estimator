import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../state/useTheme.ts";
import { navigationLinkClassName } from "../workspace/navigationStyles.ts";

const LABEL: Record<string, string> = {
	system: "System",
	light: "Light",
	dark: "Dark",
};

export function ThemeToggle() {
	const { preference, cycle } = useTheme();
	const Icon =
		preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
	return (
		<button
			type="button"
			className={navigationLinkClassName}
			onClick={cycle}
			title="Switch theme (system, light, dark)"
			aria-label={`Theme: ${LABEL[preference]}. Activate to switch theme.`}
		>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
			<span className="flex flex-col items-start leading-tight">
				<span className="text-sm font-semibold text-ink">Theme</span>
				<span className="text-xs font-normal text-muted">
					{LABEL[preference]}
				</span>
			</span>
		</button>
	);
}
