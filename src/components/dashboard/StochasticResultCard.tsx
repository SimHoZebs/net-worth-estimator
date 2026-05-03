import { Card, CardContent } from "@/components/ui/card";

interface StochasticResultCardProps {
  label: string;
  value: string;
  detail: string;
}

export function StochasticResultCard({ label, value, detail }: StochasticResultCardProps) {
  return (
    <Card className="rounded-[1.6rem] border-slate-200 shadow-sm">
      <CardContent className="p-4">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{label}</div>
        <div className="mt-1 text-xl font-semibold text-slate-900">{value}</div>
        <div className="text-xs text-slate-500">{detail}</div>
      </CardContent>
    </Card>
  );
}
