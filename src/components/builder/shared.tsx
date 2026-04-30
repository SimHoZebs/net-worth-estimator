import type { ChangeEvent, ReactNode } from "react";
import { Input, Label } from "../ui";

export interface SelectOption {
  value: string;
  label: string;
}

export function sectionButtonClassName(kind: "primary" | "secondary" | "danger" = "secondary"): string {
  switch (kind) {
    case "primary":
      return "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";
    case "danger":
      return "rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50";
    case "secondary":
    default:
      return "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
  }
}

export function Field({ label, helper, children }: { label: string; helper?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

export function NumberInput({ value, onChange, step = "any", min }: { value: number; onChange: (nextValue: number) => void; step?: number | string; min?: number }) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      onChange={(event) => onChange(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0)}
    />
  );
}

export function PercentInput({ value, onChange, step = 0.5, min = 0, max }: { value: number; onChange: (nextValue: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value * 100) ? value * 100 : 0}
      step={step}
      min={min}
      max={max}
      onChange={(event) => onChange((Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0) / 100)}
    />
  );
}

export function SelectInput({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <select
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      {children}
    </select>
  );
}

export function CheckboxInput({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
      <input type="checkbox" className="mt-1" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function handleNullableMonthChange(event: ChangeEvent<HTMLInputElement>, onChange: (value: number | null) => void) {
  const nextValue = event.currentTarget.value.trim();
  onChange(nextValue === "" ? null : Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : null);
}
