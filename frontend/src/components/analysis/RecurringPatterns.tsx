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
import { Button } from "../Button.tsx";
import { DetailRow } from "../DetailRow.tsx";
import { ErrorNotice, FieldError } from "../ErrorNotice.tsx";
import { SelectField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";

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
		<Modal
			title={`Forecast plan for ${title}`}
			eyebrow={eyebrow}
			onClose={onClose}
		>
			{preview.isPending ? (
				<p className="text-sm text-muted">Loading the forecast plan…</p>
			) : preview.isError || !plan ? (
				<ErrorNotice message="The forecast plan could not be loaded. Try again." />
			) : (
				<div className="space-y-4">
					<dl className="m-0 space-y-2">
						<DetailRow label="Suggested schedule">
							{plan.schedule?.name ?? title}
						</DetailRow>
						<DetailRow label="Amount">
							{plan.schedule
								? `${plan.schedule.amount} ${plan.currency}`
								: `${plan.typicalAmount} ${plan.currency}`}
						</DetailRow>
						{plan.schedule && (
							<>
								<DetailRow label="Repeats">
									{frequencyLabel(plan.schedule.frequency)}
								</DetailRow>
								<DetailRow label="Starts">{plan.schedule.startDate}</DetailRow>
								<DetailRow label="Account">{accountName}</DetailRow>
							</>
						)}
					</dl>
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
					<FieldError
						message={failed ? "The schedule could not be created." : null}
					/>
					<div className="flex gap-2">
						<Button type="button" variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						{plan.creatable && !readOnly && (
							<Button
								type="button"
								variant="primary"
								disabled={create.isPending}
								onClick={() =>
									create.mutate(
										{ id: findingId },
										{
											onSuccess: (result) => {
												setFailed(false);
												notifySuccess(
													"forecast-schedule",
													`Forecast schedule “${result.value.name}” created.`,
												);
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
		</Modal>
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
	return (
		<Modal title={heading} eyebrow={title} onClose={onClose}>
			<div className="space-y-4">
				<SelectField
					label="Existing forecast schedule"
					value={selected}
					onChange={(event) => {
						setScheduleId(event.target.value);
						setAdded(null);
						setAddedSchedule(null);
						setFailed(false);
					}}
				>
					<option value="">Choose a schedule…</option>
					{schedules.map((schedule) => (
						<option key={schedule.id} value={schedule.id}>
							{schedule.name}
						</option>
					))}
				</SelectField>
				{!selected ? (
					<p className="m-0 text-sm text-muted">
						Choose the forecast schedule these recorded payments belong to.
					</p>
				) : preview.isPending ? (
					<p className="text-sm text-muted">Checking the forecast schedule…</p>
				) : preview.isError || !plan ? (
					<ErrorNotice message="The link preview could not be loaded. Try again." />
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
						<FieldError
							message={failed ? "The payments could not be added." : null}
						/>
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							{plan.claimable && !readOnly && (
								<Button
									type="button"
									variant="primary"
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
		</Modal>
	);
}
