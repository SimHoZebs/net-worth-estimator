import { useState } from "react";
import type { Account } from "@/lib/projection";
import { NO_FLOOR, NO_CEILING } from "@/lib/projection/constants";
import { Button } from "@/components/ui/button";

function emptyAccount(): Account {
  return {
    id: "",
    label: "",
    minBalance: NO_FLOOR,
    maxBalance: NO_CEILING,
    color: null,
    enabled: true,
  };
}

interface WhatIfAccountFormProps {
  accounts: Account[];
  onAdd: (account: Account) => void;
  onRemove: (id: string) => void;
}

export function WhatIfAccountForm({ accounts, onAdd, onRemove }: WhatIfAccountFormProps) {
  const [adding, setAdding] = useState<Account | null>(null);

  const commit = () => {
    if (adding && adding.id.trim() && adding.label.trim()) {
      onAdd(adding);
    }
    setAdding(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
          Accounts {accounts.length > 0 ? `(${accounts.length})` : ""}
        </span>
        {!adding ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(emptyAccount())}>
            + Add
          </Button>
        ) : null}
      </div>
      {adding ? (
        <div className="space-y-2 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">ID</label>
              <input
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
                value={adding.id}
                onChange={(e) => setAdding({ ...adding, id: e.target.value })}
                placeholder="e.g. savings"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">Label</label>
              <input
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
                value={adding.label}
                onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                placeholder="Savings"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400">Color (hex)</label>
              <input
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1 text-sm"
                value={adding.color ?? ""}
                onChange={(e) => setAdding({ ...adding, color: e.target.value || null })}
                placeholder="#64748b"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={commit}>Add account</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {accounts.map((account) => (
        <div key={`tmp-acc-${account.id}`} className="flex items-center justify-between rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: account.color ?? "#eab308" }} />
            <span className="text-sm font-medium text-amber-900 dark:text-amber-200">{account.label}</span>
            <span className="text-xs text-amber-700 dark:text-amber-400">{account.id}</span>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(account.id)}>
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
