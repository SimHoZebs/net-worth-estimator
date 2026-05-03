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
    ? "border-emerald-200 bg-emerald-50"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50"
      : "border-slate-200 bg-white";

  return (
    <Card className={`rounded-[1.6rem] shadow-sm ${toneClassName}`}>
      <CardContent className="space-y-2 p-5">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className="text-lg font-semibold tracking-tight text-slate-900">{value}</div>
        <div className="text-sm text-slate-600">{detail}</div>
      </CardContent>
    </Card>
  );
});
