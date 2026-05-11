import { useEffect, useState, type ReactNode } from "react";

interface CollapsibleSectionBaseProps {
  title: string;
  description: string;
  badge?: string;
  children: ReactNode;
}

type CollapsibleSectionProps = CollapsibleSectionBaseProps & (
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      defaultOpen?: never;
      autoOpenWhen?: never;
    }
  | {
      defaultOpen?: boolean;
      autoOpenWhen?: boolean;
      open?: never;
      onOpenChange?: never;
    }
);

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
  autoOpenWhen = false,
  open,
  onOpenChange,
  badge,
  children,
}: CollapsibleSectionProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen || autoOpenWhen);
  const isOpen = isControlled ? open : internalOpen;

  useEffect(() => {
    if (!isControlled && autoOpenWhen) {
      setInternalOpen(true);
    }
  }, [autoOpenWhen, isControlled]);

  const toggleOpen = () => {
    const nextOpen = !isOpen;
    if (isControlled) {
      onOpenChange(nextOpen);
    } else {
      setInternalOpen(nextOpen);
    }
  };

  return (
    <details
      open={isOpen}
      className="rounded-[1.8rem] border border-slate-200 bg-white px-5 py-5 shadow-sm open:border-slate-300"
    >
      <summary
        className="group cursor-pointer list-none select-none"
        onClick={(event) => {
          event.preventDefault();
          toggleOpen();
        }}
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
              {isOpen ? "Hide details" : "Show details"}
            </span>
          </div>
        </div>
      </summary>
      <div className="mt-5">{children}</div>
    </details>
  );
}
