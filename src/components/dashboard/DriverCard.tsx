import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";

export const DriverCard = memo(function DriverCard({
  label,
  value,
  detail,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClassName = tone === "success"
    ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950"
    : tone === "warning"
      ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950"
      : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800";

  return (
    <Card className={`rounded-[1.6rem] shadow-sm ${toneClassName}`}>
      <CardContent className="space-y-2 p-5">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{value}</div>
        <div className="text-sm text-slate-600 dark:text-slate-400">{detail}</div>
      </CardContent>
    </Card>
  );
});
