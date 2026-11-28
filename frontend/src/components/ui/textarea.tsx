import * as React from "react";
import { cn } from "@/lib/utils.ts";

import { inputClassName } from "./control-styles.ts";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				inputClassName,
				"h-auto flex field-sizing-content min-h-16 py-2",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
