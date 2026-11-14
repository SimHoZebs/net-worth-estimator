import { useState } from "react";
import type { PatternToNewSchedulePreview } from "@/api/generated/model/patternToNewSchedulePreview.ts";
import { frequencyLabel } from "@/domain/recurringPatterns.ts";
import {
	useAddPatternToExistingSchedule,
	useCreatePatternToNewSchedule,
	usePatternToExistingSchedulePreview,
	usePatternToNewSchedulePreview,
} from "@/state/analyses.ts";
import { notifySuccess } from "@/state/notifications.ts";
import { useSavedAccounts } from "@/state/savedState.ts";
import { useTransactionCatalog } from "@/state/workspaceResources.ts";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Item, ItemContent } from "@/components/ui/item.tsx";
import { useId } from "react";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName =
	"min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0";
const primaryButtonClassName =
	"min-h-10 border-primary bg-primary px-4 py-2 text-sm leading-snug text-on-primary enabled:hover:bg-primary-hover enabled:hover:shadow-sm focus-visible:outline-solid focus-visible:ring-0";
const errorClassName =
	"m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text";

export function NewScheduleDialog({
	findingId,
	title,
	readOnly,
	eyebrow = "Repeating payment",
	onClose,
}: {
	findingId: string;
	title: string;
	readOnly: boolean;
	eyebrow?: string;
	onClose: () => void;
}) {
	const preview = usePatternToNewSchedulePreview(findingId);
	const create = useCreatePatternToNewSchedule();
	const accounts = useSavedAccounts();
	const [failed, setFailed] = useState(false);
	const plan = preview.data;
	const accountName =
		accounts?.find((account) => account.id === plan?.accountId)?.name ??
		plan?.accountId ??
		"";
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted">
						{eyebrow}
					</p>
					<DialogTitle>{`Forecast plan for ${title}`}</DialogTitle>
				</DialogHeader>
				{preview.isPending ? (
					<p className="text-sm text-muted">Loading the forecast plan…</p>
				) : preview.isError || !plan ? (
					<Alert variant="destructive">
						<AlertDescription>
							The forecast plan could not be loaded. Try again.
						</AlertDescription>
					</Alert>
				) : (
					<div className="space-y-4">
						<div className="m-0 flex flex-col gap-0">
							<ForecastDetail label="Suggested schedule">
								{plan.schedule?.name ?? title}
							</ForecastDetail>
							<ForecastDetail label="Amount">
								{plan.schedule
									? `${plan.schedule.amount} ${plan.currency}`
									: `${plan.typicalAmount} ${plan.currency}`}
							</ForecastDetail>
							{plan.schedule && (
								<>
									<ForecastDetail label="Repeats">
										{frequencyLabel(plan.schedule.frequency)}
									</ForecastDetail>
									<ForecastDetail label="Starts">
										{plan.schedule.startDate}
									</ForecastDetail>
									<ForecastDetail label="Account">{accountName}</ForecastDetail>
								</>
							)}
						</div>
						{plan.schedule && plan.upcoming && plan.upcoming.length > 0 && (
							<div>
								<h3 className="text-sm font-semibold">Upcoming</h3>
								<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted">
									{plan.upcoming.map((item) => (
										<li key={item.date}>
											{item.date} · {item.amount} {plan.currency}
										</li>
									))}
								</ul>
							</div>
						)}
						<div>
							<h3 className="text-sm font-semibold">Recorded evidence</h3>
							<p className="mb-0 mt-1 text-sm text-muted">
								{evidenceSummary(plan)}
							</p>
						</div>
						{!plan.creatable && (
							<p className="m-0 text-sm text-muted">{plan.reason}</p>
						)}
						{failed && (
							<p role="alert" className={errorClassName}>
								The schedule could not be created.
							</p>
						)}
						<div className="flex gap-2">
							<Button
								type="button"
								variant="secondary"
								className={secondaryButtonClassName}
								onClick={onClose}
							>
								Cancel
							</Button>
							{plan.creatable && !readOnly && (
								<Button
									type="button"
									variant="default"
									className={primaryButtonClassName}
									disabled={create.isPending}
									onClick={() =>
										create.mutate(
											{ id: findingId },
											{
												onSuccess: (result) => {
													setFailed(false);
													const message = `Forecast schedule “${result.value.name}” created.`;
													notifySuccess("forecast-schedule", message);
													onClose();
												},
												onError: () => setFailed(true),
											},
										)
									}
								>
									{create.isPending ? "Creating…" : "Create forecast schedule"}
								</Button>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function evidenceSummary(plan: PatternToNewSchedulePreview): string {
	const occurrences = plan.occurrences ?? [];
	const dates = occurrences.map((item) => item.date).sort();
	const range =
		dates.length > 1
			? `${dates[0]} to ${dates[dates.length - 1]}`
			: (dates[0] ?? "");
	return `${occurrences.length} recorded ${occurrences.length === 1 ? "payment" : "payments"} · ${plan.typicalAmount} ${plan.currency} typical · ${range}`;
}

function ForecastDetail({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<Item className="justify-between gap-5 rounded-none border-x-0 border-t-0 border-b border-line px-0 py-3">
			<span className="text-muted">{label}</span>
			<ItemContent className="flex-none flex-row items-center justify-end gap-2 text-right">
				{children}
			</ItemContent>
		</Item>
	);
}

export function ExistingScheduleDialog({
	findingId,
	title,
	names,
	readOnly,
	heading = "Link repeating payments to a schedule",
	onClose,
}: {
	findingId: string;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
	heading?: string;
	onClose: () => void;
}) {
	const catalog = useTransactionCatalog();
	const schedules = (catalog.data?.items ?? []).filter(
		(item) => item.kind === "schedule",
	);
	const [scheduleId, setScheduleId] = useState("");
	const selected = scheduleId || schedules[0]?.id || "";
	const preview = usePatternToExistingSchedulePreview(
		findingId,
		selected ? selected : undefined,
	);
	const add = useAddPatternToExistingSchedule();
	const [added, setAdded] = useState<number | null>(null);
	const [addedSchedule, setAddedSchedule] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const plan = preview.data;
	const scheduleFieldId = useId();
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted">
						{title}
					</p>
					<DialogTitle>{heading}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={scheduleFieldId} className={fieldLabelClassName}>
							Existing forecast schedule
						</Label>
						<select
							id={scheduleFieldId}
							value={selected}
							onChange={(event) => {
								setScheduleId(event.target.value);
								setAdded(null);
								setAddedSchedule(null);
								setFailed(false);
							}}
							className={fieldSelectClassName}
						>
							<option value="">Choose a schedule…</option>
							{schedules.map((schedule) => (
								<option key={schedule.id} value={schedule.id}>
									{schedule.name}
								</option>
							))}
						</select>
					</Field>
					{!selected ? (
						<p className="m-0 text-sm text-muted">
							Choose the forecast schedule these recorded payments belong to.
						</p>
					) : preview.isPending ? (
						<p className="text-sm text-muted">
							Checking the forecast schedule…
						</p>
					) : preview.isError || !plan ? (
						<Alert variant="destructive">
							<AlertDescription>
								The link preview could not be loaded. Try again.
							</AlertDescription>
						</Alert>
					) : added !== null ? (
						<div className="space-y-3">
							<p className="m-0 text-sm">
								{added} recorded {added === 1 ? "payment" : "payments"} now{" "}
								{added === 1 ? "records" : "record"} an occurrence of “
								{addedSchedule ?? plan.scheduleName}”. Future movements stay on
								that schedule.
							</p>
							<Button
								type="button"
								variant="secondary"
								className={secondaryButtonClassName}
								onClick={onClose}
							>
								Close
							</Button>
						</div>
					) : (
						<>
							{plan.assignments && plan.assignments.length > 0 && (
								<div>
									<h3 className="text-sm font-semibold">Matched occurrences</h3>
									<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted">
										{plan.assignments.map((item) => (
											<li key={item.transactionId}>
												{names.get(item.transactionId) ?? item.transactionId} ·{" "}
												{item.date}
												{item.amount ? ` · ${item.amount}` : ""}
											</li>
										))}
									</ul>
								</div>
							)}
							{!plan.claimable && (
								<p className="m-0 text-sm text-muted">{plan.reason}</p>
							)}
							{failed && (
								<p role="alert" className={errorClassName}>
									The payments could not be added.
								</p>
							)}
							<div className="flex gap-2">
								<Button
									type="button"
									variant="secondary"
									className={secondaryButtonClassName}
									onClick={onClose}
								>
									Cancel
								</Button>
								{plan.claimable && !readOnly && (
									<Button
										type="button"
										variant="default"
										className={primaryButtonClassName}
										disabled={add.isPending}
										onClick={() =>
											add.mutate(
												{ id: findingId, scheduleId: plan.scheduleId },
												{
													onSuccess: (result) => {
														setFailed(false);
														setAdded((result.matches ?? []).length);
														setAddedSchedule(plan.scheduleName);
													},
													onError: () => setFailed(true),
												},
											)
										}
									>
										{add.isPending ? "Linking…" : "Link payments to schedule"}
									</Button>
								)}
							</div>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
