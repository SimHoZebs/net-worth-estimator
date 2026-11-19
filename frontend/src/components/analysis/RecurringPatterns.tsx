import { useRef, useState } from "react";
import type { ComponentProps, ReactNode, Ref } from "react";
import type { PatternToNewSchedulePreview } from "@/api/generated/model/patternToNewSchedulePreview.ts";
import { recurrenceLabel } from "@/domain/recurringPatterns.ts";
import { recurrenceFromScheduleLike } from "@/domain/recurrence.ts";
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
import { cn } from "@/lib/utils.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { useId } from "react";

export const analysisErrorClassName =
	"m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text";

export function AnalysisDialogContent({
	className,
	...props
}: ComponentProps<typeof DialogContent>) {
	return (
		<DialogContent
			className={cn(
				"max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Single vocabulary for the forecast-schedule pair so repeating rows,
 * payment rows, and transaction insights share order, labels, and
 * dialog titles instead of drifting through kind-specific overrides.
 */
export const FORECAST_SCHEDULE_EYEBROW = "Repeating payment";
export const FORECAST_SCHEDULE_LINK_HEADING =
	"Link repeating payments to a schedule";

export interface ForecastScheduleTitles {
	eyebrow: string;
	heading: string;
}

export type ForecastScheduleDialog = "new" | "existing";

/**
 * The shared create-plus-link button pair with one order, one set of
 * labels, and one aria vocabulary. Extra answers (Not repeating, Review
 * again) slot in via before/after. Dialog ownership stays with the
 * caller: ForecastScheduleActions mounts them inline, while surfaces
 * that must survive queue refreshes (transaction insights) mount the
 * dialogs at panel level and wire this pair to them.
 */
export function ForecastScheduleButtons({
	title,
	readOnly,
	before,
	after,
	onCreate,
	onLink,
	createRef,
	linkRef,
}: {
	title: string;
	readOnly: boolean;
	before?: ReactNode;
	after?: ReactNode;
	onCreate: () => void;
	onLink: () => void;
	createRef?: Ref<HTMLButtonElement>;
	linkRef?: Ref<HTMLButtonElement>;
}) {
	const planLabel = readOnly
		? "Review forecast plan"
		: "Create forecast schedule";
	return (
		<div className="flex flex-wrap gap-2">
			{before}
			<Button
				type="button"
				size="sm"
				variant={readOnly ? "secondary" : "default"}
				ref={createRef}
				aria-label={`${planLabel} for ${title}`}
				onClick={onCreate}
			>
				{planLabel}
			</Button>
			<Button
				type="button"
				size="sm"
				variant="secondary"
				ref={linkRef}
				aria-label={`Link to existing schedule for ${title}`}
				onClick={onLink}
			>
				Link to existing schedule
			</Button>
			{after}
		</div>
	);
}

/**
 * The shared create-plus-link pair for one finding. Callers render only
 * their extra answers (Not repeating, Review again) around it via
 * before/after. Owns both dialog open states and returns focus to the
 * invoking button on close.
 */
export function ForecastScheduleActions({
	findingId,
	title,
	names,
	readOnly,
	titles,
	before,
	after,
}: {
	findingId: string;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
	titles: ForecastScheduleTitles;
	before?: ReactNode;
	after?: ReactNode;
}) {
	const [dialog, setDialog] = useState<ForecastScheduleDialog | null>(null);
	const planButtonRef = useRef<HTMLButtonElement>(null);
	const linkButtonRef = useRef<HTMLButtonElement>(null);
	const closeDialog = () => {
		const current = dialog;
		setDialog(null);
		const target = current === "existing" ? linkButtonRef : planButtonRef;
		requestAnimationFrame(() => target.current?.focus());
	};
	return (
		<>
			<ForecastScheduleButtons
				title={title}
				readOnly={readOnly}
				before={before}
				after={after}
				createRef={planButtonRef}
				linkRef={linkButtonRef}
				onCreate={() => setDialog("new")}
				onLink={() => setDialog("existing")}
			/>
			{dialog === "new" && (
				<NewScheduleDialog
					findingId={findingId}
					title={title}
					readOnly={readOnly}
					eyebrow={titles.eyebrow}
					onClose={closeDialog}
				/>
			)}
			{dialog === "existing" && (
				<ExistingScheduleDialog
					findingId={findingId}
					title={title}
					names={names}
					readOnly={readOnly}
					heading={titles.heading}
					onClose={closeDialog}
				/>
			)}
		</>
	);
}

export function NewScheduleDialog({
	findingId,
	title,
	readOnly,
	eyebrow = FORECAST_SCHEDULE_EYEBROW,
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
			<AnalysisDialogContent>
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						{eyebrow}
					</p>
					<DialogTitle>{`Forecast plan for ${title}`}</DialogTitle>
				</DialogHeader>
				{preview.isPending ? (
					<p className="text-sm text-muted-foreground">
						Loading the forecast plan…
					</p>
				) : preview.isError || !plan ? (
					<Alert variant="destructive">
						<AlertDescription>
							The forecast plan could not be loaded. Try again.
						</AlertDescription>
					</Alert>
				) : (
					<div className="space-y-4">
						<ForecastRows plan={plan} title={title} accountName={accountName} />
						{(plan.upcoming ?? []).length > 0 && plan.schedule && (
							<div>
								<h3 className="text-sm font-semibold">Upcoming</h3>
								<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted-foreground">
									{(plan.upcoming ?? []).map((item) => (
										<li key={item.date}>
											{item.date} · {item.amount} {plan.currency}
										</li>
									))}
								</ul>
							</div>
						)}
						<div>
							<h3 className="text-sm font-semibold">Recorded evidence</h3>
							<p className="mb-0 mt-1 text-sm text-muted-foreground">
								{evidenceSummary(plan)}
							</p>
						</div>
						{!plan.creatable && plan.reason && (
							<p className="m-0 text-sm text-muted-foreground">{plan.reason}</p>
						)}
						{failed && (
							<p role="alert" className={analysisErrorClassName}>
								The schedule could not be created.
							</p>
						)}
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							{plan.creatable && !readOnly && (
								<Button
									type="button"
									variant="default"
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
			</AnalysisDialogContent>
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

function ForecastRows({
	plan,
	title,
	accountName,
}: {
	plan: PatternToNewSchedulePreview;
	title: string;
	accountName: string;
}) {
	const rows: { label: string; value: ReactNode }[] = [
		{ label: "Suggested schedule", value: plan.schedule?.name ?? title },
		{
			label: "Amount",
			value: plan.schedule
				? `${plan.schedule.amount} ${plan.currency}`
				: `${plan.typicalAmount} ${plan.currency}`,
		},
		...(plan.schedule
			? [
					{
						label: "Repeats",
						value: (() => {
							const recurrence = recurrenceFromScheduleLike(plan.schedule);
							return recurrence && plan.schedule
								? recurrenceLabel(recurrence, plan.schedule.startDate)
								: "Repeating";
						})(),
					},
					{ label: "Starts", value: plan.schedule.startDate },
					{ label: "Account", value: accountName },
				]
			: []),
	];
	return (
		<dl className="m-0 divide-y divide-border">
			{rows.map((row) => (
				<div
					key={row.label}
					className="flex items-baseline justify-between gap-5 py-2 first:pt-0 last:pb-0"
				>
					<dt className="text-sm text-muted-foreground">{row.label}</dt>
					<dd className="m-0 text-right text-sm">{row.value}</dd>
				</div>
			))}
		</dl>
	);
}

export function ExistingScheduleDialog({
	findingId,
	title,
	names,
	readOnly,
	heading = FORECAST_SCHEDULE_LINK_HEADING,
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
	const selectedLabel =
		schedules.find((schedule) => schedule.id === selected)?.name ??
		"Choose a schedule…";
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
			<AnalysisDialogContent>
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						{title}
					</p>
					<DialogTitle>{heading}</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={scheduleFieldId}>Existing forecast schedule</Label>
						<Select
							name="schedule"
							value={selected}
							onValueChange={(value) => {
								setScheduleId(value ?? "");
								setAdded(null);
								setAddedSchedule(null);
								setFailed(false);
							}}
						>
							<SelectTrigger id={scheduleFieldId}>
								<SelectValue>{selectedLabel}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">Choose a schedule…</SelectItem>
								{schedules.map((schedule) => (
									<SelectItem key={schedule.id} value={schedule.id}>
										{schedule.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					{!selected ? (
						<p className="m-0 text-sm text-muted-foreground">
							Forecast schedule for these recorded payments.
						</p>
					) : preview.isPending ? (
						<p className="text-sm text-muted-foreground">
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
							<Button type="button" variant="secondary" onClick={onClose}>
								Close
							</Button>
						</div>
					) : (
						<>
							{(plan.assignments ?? []).length > 0 && (
								<div>
									<h3 className="text-sm font-semibold">Matched occurrences</h3>
									<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted-foreground">
										{(plan.assignments ?? []).map((item) => (
											<li key={item.transactionId}>
												{names.get(item.transactionId) ?? item.transactionId} ·{" "}
												{item.date}
												{item.amount ? ` · ${item.amount}` : ""}
											</li>
										))}
									</ul>
								</div>
							)}
							{!plan.claimable && plan.reason && (
								<p className="m-0 text-sm text-muted-foreground">
									{plan.reason}
								</p>
							)}
							{failed && (
								<p role="alert" className={analysisErrorClassName}>
									The payments could not be added.
								</p>
							)}
							<div className="flex gap-2">
								<Button type="button" variant="secondary" onClick={onClose}>
									Cancel
								</Button>
								{plan.claimable && !readOnly && (
									<Button
										type="button"
										variant="default"
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
			</AnalysisDialogContent>
		</Dialog>
	);
}
