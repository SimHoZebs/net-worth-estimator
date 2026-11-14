import { Banknote } from "lucide-react";

export function AccountIconFallback() {
	return (
		<span className="inline-flex size-8 flex-none items-center justify-center rounded-md border border-border bg-card text-muted-foreground">
			<Banknote size={15} aria-hidden="true" />
		</span>
	);
}
