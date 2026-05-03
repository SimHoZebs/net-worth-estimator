export function ColorSwatch({ color }: { color: string | null }) {
  if (!color) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-4 w-4 rounded border border-slate-200"
        style={{ backgroundColor: color }}
        title={color}
      />
      <span className="font-mono text-xs text-slate-500">{color}</span>
    </div>
  );
}
