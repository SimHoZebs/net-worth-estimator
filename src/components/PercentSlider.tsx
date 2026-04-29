import { Label } from "./ui";

interface PercentSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

export function PercentSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = "%",
}: PercentSliderProps) {
  return (
    <div className="space-y-3">
      <div className="flex justify-between gap-4">
        <Label>{label}</Label>
        <span className="font-semibold">{value}{suffix}</span>
      </div>
      <input
        type="range"
        className="h-2 w-full cursor-pointer accent-slate-900"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
  );
}
