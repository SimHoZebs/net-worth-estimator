import type { InputHTMLAttributes, LabelHTMLAttributes, PropsWithChildren } from "react";

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

interface CardProps extends PropsWithChildren {
  className?: string;
}

export function Card({ className = "", children }: CardProps) {
  return <div className={cx("border border-slate-200 bg-white", className)}>{children}</div>;
}

export function CardContent({ className = "", children }: CardProps) {
  return <div className={className}>{children}</div>;
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className = "", ...props }: InputProps) {
  return (
    <input
      className={cx(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200",
        className
      )}
      {...props}
    />
  );
}

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = "", children, ...props }: LabelProps) {
  return (
    <label className={cx("block text-sm font-medium text-slate-900", className)} {...props}>
      {children}
    </label>
  );
}
