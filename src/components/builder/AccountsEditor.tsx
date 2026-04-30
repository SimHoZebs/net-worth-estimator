import { memo } from "react";
import {
  addAccount,
  DEFAULT_SCENARIO_DEFINITION,
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

function collectReferencedAccountIds(
  modules: ScenarioDefinition["modules"],
  allocationPolicies: ScenarioDefinition["allocationPolicies"]
): Set<string> {
  const referencedAccountIds = new Set<string>();

  for (const module of modules) {
    switch (module.type) {
      case "retirementPlan":
      case "equityGrantSeries":
        referencedAccountIds.add(module.destinationAccountId);
        break;
      case "scheduledTransfer":
        referencedAccountIds.add(module.sourceAccountId);
        referencedAccountIds.add(module.destinationAccountId);
        break;
      default:
        break;
    }
  }

  for (const policy of allocationPolicies) {
    referencedAccountIds.add(policy.sourceAccountId);

    for (const step of policy.steps) {
      referencedAccountIds.add(step.destinationAccountId);
    }

    for (const override of policy.overrides) {
      for (const step of override.steps) {
        referencedAccountIds.add(step.destinationAccountId);
      }
    }
  }

  return referencedAccountIds;
}

const AccountCard = memo(function AccountCard({
  accountIndex,
  isReferenced,
  removeAccount,
}: {
  accountIndex: number;
  isReferenced: boolean;
  removeAccount: (index: number) => void;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const account = useWatch({
    control,
    name: `accounts.${accountIndex}` as const,
  }) as ScenarioDefinition["accounts"][number] | undefined;

  if (!account) return null;

  const isCashAccount = account.id === "cash";

  return (
    <Card className="min-w-[340px] max-w-[420px] shrink-0 rounded-[1.6rem] border-slate-200 bg-white">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-slate-900">{account.label}</h3>
            <p className="text-xs text-slate-500">ID: <code>{account.id}</code></p>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={isCashAccount || isReferenced}
            onClick={() => removeAccount(accountIndex)}
          >
            Remove
          </Button>
        </div>

        {isCashAccount ? <p className="text-xs text-slate-500">Cash is the default liquidity pool for policy execution and cannot be removed.</p> : null}
        {!isCashAccount && isReferenced ? <p className="text-xs text-amber-700">This account is currently referenced by a module or policy, so remove or retarget those references first.</p> : null}

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
});

export function AccountsEditor() {
  const { control, getValues } = useFormContext<ScenarioDefinition>();
  const modules = (useWatch({ control, name: "modules" }) ?? DEFAULT_SCENARIO_DEFINITION.modules) as ScenarioDefinition["modules"];
  const allocationPolicies = (useWatch({ control, name: "allocationPolicies" }) ?? DEFAULT_SCENARIO_DEFINITION.allocationPolicies) as ScenarioDefinition["allocationPolicies"];
  const { fields, append, remove } = useFieldArray({ control, name: "accounts" });
  const referencedAccountIds = collectReferencedAccountIds(modules, allocationPolicies);
  const accountIds = getValues("accounts").map((account) => account.id);

  const appendAccount = (kind: ScenarioAccountDefinition["kind"]) => {
    const nextAccounts = addAccount(getValues(), kind).accounts;
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
          {fields.map((field, accountIndex) => (
            <AccountCard
              key={field.id}
              accountIndex={accountIndex}
              isReferenced={referencedAccountIds.has(accountIds[accountIndex] ?? "")}
              removeAccount={remove}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
