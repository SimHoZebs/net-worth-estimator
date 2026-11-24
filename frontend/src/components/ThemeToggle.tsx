import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "../state/useTheme.ts";
import { Button } from "@/components/ui/button.tsx";

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
		<Button
			type="button"
			variant="ghost"
			size="default"
			className="w-full justify-start group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0!"
			onClick={cycle}
			title="Switch theme (system, light, dark)"
			aria-label={`Theme: ${LABEL[preference]}`}
			aria-description="Activate to switch between system, light, and dark themes."
		>
			<Icon aria-hidden="true" />
			<span className="group-data-[collapsible=icon]:hidden">
				Theme: {LABEL[preference]}
			</span>
		</Button>
	);
}
