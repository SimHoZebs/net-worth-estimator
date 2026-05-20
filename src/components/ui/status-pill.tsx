import type * as React from "react";
import { cn } from "@/lib/utils";

function StatusPill({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="status-pill"
			className={cn(
				"rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { StatusPill };
