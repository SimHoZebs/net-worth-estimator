import { Check } from "lucide-react";

export function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="relative inline-flex cursor-pointer items-center gap-2 text-xs text-muted max-sm:min-h-7 max-sm:gap-1">
			<input
				type="checkbox"
				role="switch"
				aria-checked={checked}
				checked={checked}
				className="peer absolute w-px opacity-0"
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="flex h-4 w-7 items-center rounded-full bg-line-strong p-0.5 transition-colors duration-150 peer-checked:bg-primary peer-focus-visible:outline-3 peer-focus-visible:outline-solid peer-focus-visible:outline-primary peer-focus-visible:outline-offset-1">
				<span
					className={`grid size-3 place-items-center rounded-full bg-surface text-primary transition-transform duration-150 ${checked ? "translate-x-3" : ""}`}
				>
					{checked && <Check size={10} />}
				</span>
			</span>
			<span>{label}</span>
		</label>
	);
}
