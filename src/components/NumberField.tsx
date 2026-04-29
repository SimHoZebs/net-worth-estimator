import { Input, Label } from "./ui";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  helper?: string;
  className?: string;
}

export function NumberField({ label, value, onChange, helper, className = "" }: NumberFieldProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0)}
      />
      {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}
