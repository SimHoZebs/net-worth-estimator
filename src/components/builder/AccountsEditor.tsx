import {
  addAccount,
  DEFAULT_SCENARIO_DEFINITION,
  isAccountReferenced,
  type ScenarioAccountDefinition,
} from "../../lib/projection";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { ScenarioDefinition } from "@/lib/projection";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NumberField, PercentField, SelectField, TextField } from "./shared";

function accountKindLabel(kind: ScenarioAccountDefinition["kind"]): string {
  switch (kind) {
    case "cash":
      return "Cash";
    case "liability":
      return "Liability";
    case "asset":
    default:
      return "Asset";
  }
}

export function AccountsEditor() {
  const { control } = useFormContext<ScenarioDefinition>();
  const scenario = (useWatch({ control }) ?? DEFAULT_SCENARIO_DEFINITION) as ScenarioDefinition;
  const accounts = (useWatch({ control, name: "accounts" }) ?? DEFAULT_SCENARIO_DEFINITION.accounts) as ScenarioDefinition["accounts"];
  const { fields, append, remove } = useFieldArray({ control, name: "accounts" });

  const appendAccount = (kind: ScenarioAccountDefinition["kind"]) => {
    const nextAccounts = addAccount(scenario, kind).accounts;
    const nextAccount = nextAccounts[nextAccounts.length - 1];
    if (nextAccount) {
      append(nextAccount);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Accounts</h2>
          <p className="text-sm text-slate-500">These are the balances the runtime mutates over time.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => appendAccount("asset")}>Add asset</Button>
          <Button type="button" variant="secondary" onClick={() => appendAccount("liability")}>Add liability</Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 pb-4">
        {fields.map((field, accountIndex) => {
          const account = accounts[accountIndex];
          if (!account) return null;
          const accountIsReferenced = isAccountReferenced(scenario, account.id);
          const isCashAccount = account.id === "cash";

          return (
            <Card key={field.id} className="min-w-[340px] max-w-[420px] shrink-0 rounded-[1.6rem] border-slate-200 bg-white">
              <CardContent className="space-y-4 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{account.label}</h3>
                  <p className="text-xs text-slate-500">ID: <code>{account.id}</code></p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isCashAccount || accountIsReferenced}
                  onClick={() => remove(accountIndex)}
                >
                  Remove
                </Button>
              </div>

              {isCashAccount ? <p className="text-xs text-slate-500">Cash is the default liquidity pool for policy execution and cannot be removed.</p> : null}
              {!isCashAccount && accountIsReferenced ? <p className="text-xs text-amber-700">This account is currently referenced by a module or policy, so remove or retarget those references first.</p> : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <TextField name={`accounts.${accountIndex}.label`} label="Label" />
                <SelectField name={`accounts.${accountIndex}.kind`} label="Kind">
                    <option value="cash" disabled={!isCashAccount}>Cash</option>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                </SelectField>
                <NumberField name={`accounts.${accountIndex}.openingBalance`} label="Opening balance" min={0} transform={(value) => Math.max(0, value)} />
                <NumberField name={`accounts.${accountIndex}.minBalance`} label="Minimum balance" helper="Useful for reserving emergency cash or minimum debt floors." min={0} transform={(value) => Math.max(0, value)} />
                <TextField name={`accounts.${accountIndex}.color`} label="Color" helper="Used in charts." />
                <div className="md:col-span-2">
                  <PercentField
                    name={`accounts.${accountIndex}.annualRate`}
                    label="Annual rate %"
                    helper={`Positive balances grow upward. ${accountKindLabel(account.kind)} balances use the same generic runtime rate rule.`}
                    min={0}
                    transform={(value) => Math.max(0, value)}
                  />
                </div>
              </div>
              </CardContent>
            </Card>
          );
        })}
        </div>
      </div>
    </div>
  );
}
