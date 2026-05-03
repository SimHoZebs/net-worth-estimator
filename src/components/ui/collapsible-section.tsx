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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
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
  const isOpen = open ?? defaultOpen;

  return (
    <details
      open={isOpen}
      className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300"
    >
      <summary
        className="group cursor-pointer list-none select-none"
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
          <div className="flex items-start gap-3">
            <div className="mt-1">
              <Chevron open={isOpen} />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">{title}</div>
              <div className="text-sm text-slate-500">{description}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {badge ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {badge}
              </span>
            ) : null}
            <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-400 group-hover:text-slate-500 transition-colors">
              {isControlled ? (isOpen ? "Hide details" : "Show details") : "Show details"}
            </span>
          </div>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}
