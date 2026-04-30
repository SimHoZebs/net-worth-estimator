import type { ReactNode } from "react";
import { Controller, useFormContext, type FieldPath } from "react-hook-form";
import type { ScenarioDefinition } from "@/lib/projection";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

function fieldId(name: FieldPath<ScenarioDefinition>) {
  return `field-${String(name).replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function Field({
  label,
  helper,
  error,
  htmlFor,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-900">{label}</label>
      {children}
      {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}

function fieldInputClassName(hasError: boolean) {
  return cn(hasError && "border-red-500 focus-visible:border-red-500 focus-visible:ring-red-200");
}

export function TextField({
  name,
  label,
  helper,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} helper={helper} error={fieldState.error?.message} htmlFor={inputId}>
          <Input id={inputId} {...field} className={fieldInputClassName(Boolean(fieldState.error))} value={typeof field.value === "string" ? field.value : ""} />
        </Field>
      )}
    />
  );
}

export function NumberField({
  name,
  label,
  helper,
  step = "any",
  min,
  max,
  transform,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
  step?: number | string;
  min?: number;
  max?: number;
  transform?: (value: number) => number;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} helper={helper} error={fieldState.error?.message} htmlFor={inputId}>
          <Input
            id={inputId}
            type="number"
            value={typeof field.value === "number" && Number.isFinite(field.value) ? field.value : 0}
            step={step}
            min={min}
            max={max}
            className={fieldInputClassName(Boolean(fieldState.error))}
            onChange={(event) => {
              const nextValue = Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0;
              field.onChange(transform ? transform(nextValue) : nextValue);
            }}
          />
        </Field>
      )}
    />
  );
}

export function PercentField({
  name,
  label,
  helper,
  step = 0.5,
  min = 0,
  max,
  transform,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
  step?: number;
  min?: number;
  max?: number;
  transform?: (value: number) => number;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} helper={helper} error={fieldState.error?.message} htmlFor={inputId}>
          <Input
            id={inputId}
            type="number"
            value={typeof field.value === "number" && Number.isFinite(field.value * 100) ? field.value * 100 : 0}
            step={step}
            min={min}
            max={max}
            className={fieldInputClassName(Boolean(fieldState.error))}
            onChange={(event) => {
              const nextValue = (Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : 0) / 100;
              field.onChange(transform ? transform(nextValue) : nextValue);
            }}
          />
        </Field>
      )}
    />
  );
}

export function SelectField({
  name,
  label,
  helper,
  children,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} helper={helper} error={fieldState.error?.message} htmlFor={inputId}>
          <NativeSelect id={inputId} {...field} className={fieldInputClassName(Boolean(fieldState.error))} value={String(field.value ?? "")}>
            {children}
          </NativeSelect>
        </Field>
      )}
    />
  );
}

export function CheckboxField({
  name,
  label,
  helper,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="space-y-2">
          <label htmlFor={inputId} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            <input
              id={inputId}
              type="checkbox"
              checked={Boolean(field.value)}
              onChange={(event) => field.onChange(event.currentTarget.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-900"
            />
            <span>
              <span className="block font-medium text-slate-900">{label}</span>
              {helper ? <span className="mt-1 block text-slate-500">{helper}</span> : null}
            </span>
          </label>
          {fieldState.error?.message ? <p className="text-xs font-medium text-red-600">{fieldState.error.message}</p> : null}
        </div>
      )}
    />
  );
}

export function NullableMonthField({
  name,
  label,
  helper,
}: {
  name: FieldPath<ScenarioDefinition>;
  label: string;
  helper?: string;
}) {
  const { control } = useFormContext<ScenarioDefinition>();
  const inputId = fieldId(name);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field label={label} helper={helper} error={fieldState.error?.message} htmlFor={inputId}>
          <Input
            id={inputId}
            type="number"
            value={typeof field.value === "number" ? field.value : ""}
            min={0}
            step={1}
            className={fieldInputClassName(Boolean(fieldState.error))}
            onChange={(event) => {
              const nextValue = event.currentTarget.value.trim();
              field.onChange(nextValue === "" ? null : Number.isFinite(event.currentTarget.valueAsNumber) ? event.currentTarget.valueAsNumber : null);
            }}
          />
        </Field>
      )}
    />
  );
}
