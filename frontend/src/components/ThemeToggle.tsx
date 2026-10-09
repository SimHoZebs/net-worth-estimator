import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../state/useTheme.ts";

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
			className="nav-link theme-toggle"
			onClick={cycle}
			title="Switch theme (system, light, dark)"
			aria-label={`Theme: ${LABEL[preference]}. Activate to switch theme.`}
		>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
			<span>Theme · {LABEL[preference]}</span>
		</button>
	);
}
