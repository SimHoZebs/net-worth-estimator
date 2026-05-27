import {
	DayPicker,
	type DayPickerProps,
	getDefaultClassNames,
} from "react-day-picker";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Calendar({
	className,
	classNames,
	showOutsideDays = true,
	...props
}: DayPickerProps) {
	const defaultClassNames = getDefaultClassNames();

	return (
		<DayPicker
			showOutsideDays={showOutsideDays}
			className={cn("p-3", className)}
			classNames={{
				root: cn("w-full", defaultClassNames.root),
				months: "flex flex-col gap-4 lg:flex-row",
				month: "relative space-y-4",
				month_caption: "flex h-9 items-center justify-center px-10 type-title",
				caption_label: "text-sm font-semibold",
				nav: "absolute right-0 top-0 flex items-center gap-1",
				button_previous: cn(
					buttonVariants({ variant: "ghost", size: "icon-sm" }),
					"text-muted-foreground",
				),
				button_next: cn(
					buttonVariants({ variant: "ghost", size: "icon-sm" }),
					"text-muted-foreground",
				),
				chevron: "h-4 w-4",
				month_grid: "w-full border-collapse",
				weekdays: "border-b border-border/70",
				weekday:
					"h-8 px-0 text-center text-[0.7rem] font-medium uppercase tracking-[0.12em] text-muted-foreground/70",
				week: "",
				day: "p-0 text-center align-middle",
				day_button: cn(
					buttonVariants({ variant: "ghost", size: "icon" }),
					"h-9 w-9 rounded-full text-sm font-normal text-foreground/80 aria-selected:opacity-100",
				),
				today:
					"[&_button]:border [&_button]:border-ring/60 [&_button]:bg-accent/45 [&_button]:text-foreground",
				selected:
					"[&_button]:bg-primary [&_button]:text-primary-foreground [&_button]:shadow-[0_8px_18px_color-mix(in_oklab,var(--primary)_28%,transparent)] [&_button]:hover:bg-primary",
				outside: "text-muted-foreground/50 [&_button]:text-muted-foreground/50",
				disabled:
					"opacity-30 [&_button]:cursor-not-allowed [&_button]:hover:bg-transparent",
				hidden: "invisible",
				...classNames,
			}}
			{...props}
		/>
	);
}

Calendar.displayName = "Calendar";

export { Calendar };
