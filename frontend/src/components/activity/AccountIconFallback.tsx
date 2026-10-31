import { Banknote } from "lucide-react";

export function AccountIconFallback() {
  return (
    <span className="inline-flex size-8 flex-none items-center justify-center rounded-surface border border-line bg-surface text-muted">
      <Banknote size={15} aria-hidden="true" />
    </span>
  );
}
