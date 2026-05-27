import type * as React from "react";
import { cn } from "@/lib/utils";

function StatusPill({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="status-pill"
			className={cn(
				"rounded-full border border-border/70 bg-muted/75 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground shadow-sm dark:border-white/10",
				className,
			)}
			{...props}
		/>
	);
}

export { StatusPill };
