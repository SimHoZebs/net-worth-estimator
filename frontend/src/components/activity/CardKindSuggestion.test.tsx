import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	CardKindSuggestion,
	focusAccountKindPicker,
} from "./CardKindSuggestion.tsx";

function finding(): AnalysisFinding {
	return {
		analysisType: "card-kind",
		analyzerVersion: "v1",
		dismissed: false,
		evidence: [
			{
				code: "card-issuer",
				reason: "The issuer name matches a card provider.",
				transactionIds: null,
			},
		],
		feedbackRevision: 0,
		firstDetectedAt: 1,
		id: "card-1",
		inputRevision: 1,
		kind: "credit_card",
		lastCheckedAt: 2,
		product: "",
		provider: "",
		role: "",
		runId: "run-1",
		stale: false,
		status: "active",
		strength: "strong",
		transactionId: "",
		accountId: "account-1",
	} as AnalysisFinding;
}

function renderCard(overrides: { readOnly?: boolean; busy?: boolean } = {}) {
	const onReview = vi.fn();
	const onDismiss = vi.fn();
	render(
		<CardKindSuggestion
			finding={finding()}
			readOnly={overrides.readOnly ?? false}
			busy={overrides.busy}
			onReview={onReview}
			onDismiss={onDismiss}
		/>,
	);
	return { onReview, onDismiss };
}

describe("card-kind suggestion card", () => {
	it("asks whether the account is the proposed kind", () => {
		const { onReview, onDismiss } = renderCard();
		expect(
			screen.getByRole("heading", {
				name: "Should this account be Credit card?",
			}),
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "Account type suggestion" }),
		).toBeTruthy();
		expect(onReview).not.toHaveBeenCalled();
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("exposes the yes and no icon actions by accessible name", () => {
		renderCard();
		const review = screen.getByRole("button", {
			name: "Review account type",
		});
		const dismiss = screen.getByRole("button", {
			name: "Dismiss suggestion",
		});
		expect(review.querySelector("svg")).toBeTruthy();
		expect(review.textContent).toBe("");
		expect(dismiss.querySelector("svg")).toBeTruthy();
		expect(dismiss.textContent).toBe("");
	});

	it("reviews the account type on yes and dismisses on no", () => {
		const { onReview, onDismiss } = renderCard();
		fireEvent.click(
			screen.getByRole("button", { name: "Review account type" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
		expect(onReview).toHaveBeenCalledTimes(1);
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("locks both actions for a read-only or busy owner", () => {
		const { onReview, onDismiss } = renderCard({ readOnly: true });
		expect(
			(
				screen.getByRole("button", {
					name: "Review account type",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Dismiss suggestion",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Review account type" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestion" }));
		expect(onReview).not.toHaveBeenCalled();
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("locks both actions while busy", () => {
		const { onReview, onDismiss } = renderCard({ busy: true });
		expect(
			(
				screen.getByRole("button", {
					name: "Review account type",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Dismiss suggestion",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(onReview).not.toHaveBeenCalled();
		expect(onDismiss).not.toHaveBeenCalled();
	});

	it("moves focus to the existing account type picker on review", () => {
		const picker = document.createElement("button");
		picker.id = "account-form-kind";
		picker.type = "button";
		document.body.append(picker);
		expect(focusAccountKindPicker("account-form")).toBe(true);
		expect(document.activeElement).toBe(picker);
		picker.disabled = true;
		expect(focusAccountKindPicker("account-form")).toBe(false);
	});
});
