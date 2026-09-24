import type * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			data-slot="input"
			className={cn(
				"flex w-full rounded-lg border border-input/90 bg-card/80 px-2 py-1 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-card focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-card/70",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
