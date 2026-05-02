import type { ReactNode } from "react";

interface CollapsibleSectionProps {
  title: string;
  description: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  badge?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  description,
  defaultOpen = false,
  open,
  onOpenChange,
  badge,
  children,
}: CollapsibleSectionProps) {
  const isControlled = onOpenChange !== undefined;

  return (
    <details
      open={open ?? defaultOpen}
      className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300"
    >
      <summary
        className="cursor-pointer list-none"
        {...(isControlled
          ? {
              onClick: (event: React.MouseEvent) => {
                event.preventDefault();
                onOpenChange(!open);
              },
            }
          : {})}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-slate-900">{title}</div>
            <div className="text-sm text-slate-500">{description}</div>
          </div>
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            {badge ?? (isControlled ? (open ? "Close" : "Open") : "Open")}
          </div>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}
