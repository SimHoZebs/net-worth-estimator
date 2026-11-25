import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import type { SafeSpendingSettingsUpdate } from "@/state/useSafeSpendingSettings.ts";
import type { Account } from "@/domain/model.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { useSafeSpendingDraft } from "./useSafeSpendingDraft.ts";

const defaults: SafeSpendingSettings = {
	cycleStartDay: 20,
	paydayDay: 30,
	savingsTarget: 0,
	accountIds: null,
	spendingAccountIds: null,
	incomeScheduleIds: [],
	transactionIds: null,
};

type DraftProps = {
	saved: SafeSpendingSettings;
	settingsMutating?: boolean;
	settingsRevision?: number;
};

function renderDraft(
	updateSettings: SafeSpendingSettingsUpdate = vi.fn(async () => {}),
	settings = defaults,
) {
	return renderHook(
		({
			saved,
			settingsMutating = false,
			settingsRevision = 0,
		}: {
			saved: SafeSpendingSettings;
			settingsMutating?: boolean;
			settingsRevision?: number;
		}) =>
			useSafeSpendingDraft({
				settings: saved,
				settingsMutating,
				settingsRevision,
				updateSettings,
				accounts: [],
				rules: [],
				savedRules: [],
				displayToday: "2026-11-25",
			}),
		{ initialProps: { saved: settings } as DraftProps },
	);
}

describe("safe spending draft lifecycle", () => {
	it("adopts settings that load after a clean URL-restored modal opens", async () => {
		const { result, rerender } = renderDraft();
		expect(result.current.numericInputs.cycleStartDay).toBe("20");

		rerender({
			saved: {
				...defaults,
				cycleStartDay: 7,
				paydayDay: 15,
				savingsTarget: 250,
			},
		});

		await waitFor(() => {
			expect(result.current.numericInputs).toEqual({
				cycleStartDay: "7",
				paydayDay: "15",
				savingsTarget: "250",
			});
		});
		expect(result.current.dirty).toBe(false);

		act(() => result.current.setNumericValue("savingsTarget", "300"));
		expect(result.current.numericInputs).toEqual({
			cycleStartDay: "7",
			paydayDay: "15",
			savingsTarget: "300",
		});
		expect(result.current.dirtyNumericFields).toEqual({
			cycleStartDay: false,
			paydayDay: false,
			savingsTarget: true,
		});
	});

	it("preserves a dirty draft when saved settings change", () => {
		const { result, rerender } = renderDraft();
		act(() => result.current.setNumericValue("savingsTarget", "450"));
		rerender({ saved: { ...defaults, savingsTarget: 900 } });

		expect(result.current.numericInputs.savingsTarget).toBe("450");
		expect(result.current.dirty).toBe(true);
	});

	it("keeps the draft through an in-flight save, blocks double submits, and clears it after success", async () => {
		let finish!: () => void;
		const updateSettings = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const { result, rerender } = renderDraft(updateSettings);
		act(() => result.current.setNumericValue("savingsTarget", "450"));
		let first!: Promise<void>;
		let second!: Promise<void>;
		act(() => {
			first = result.current.save();
			second = result.current.save();
		});
		expect(updateSettings).toHaveBeenCalledTimes(1);
		expect(updateSettings).toHaveBeenCalledWith(
			expect.objectContaining({ savingsTarget: 450 }),
			{ retry: false },
		);
		expect(result.current.saving).toBe(true);

		rerender({ saved: { ...defaults, savingsTarget: 450 } });
		expect(result.current.numericInputs.savingsTarget).toBe("450");
		expect(result.current.dirty).toBe(true);

		await act(async () => {
			finish();
			await Promise.all([first, second]);
		});
		expect(result.current.saving).toBe(false);
		expect(result.current.dirty).toBe(false);
		expect(result.current.saveFailed).toBe(false);
	});

	it("keeps dirty values and highlights after a failed save for retry", async () => {
		const updateSettings = vi.fn(async () => {
			throw new Error("Offline");
		});
		const { result } = renderDraft(updateSettings);
		act(() => result.current.setNumericValue("savingsTarget", "450"));
		await act(async () => result.current.save());

		expect(result.current.numericInputs.savingsTarget).toBe("450");
		expect(result.current.dirtyNumericFields.savingsTarget).toBe(true);
		expect(result.current.dirty).toBe(true);
		expect(result.current.saveFailed).toBe(true);
		expect(result.current.saving).toBe(false);
	});

	it("commits an external retry before adopting a later saved snapshot", async () => {
		const updateSettings = vi.fn(async () => {
			throw new Error("Offline");
		});
		const { result, rerender } = renderDraft(updateSettings);
		act(() => result.current.setNumericValue("savingsTarget", "450"));
		await act(async () => result.current.save());
		expect(result.current.dirty).toBe(true);

		rerender({
			saved: { ...defaults, savingsTarget: 450 },
			settingsRevision: 0,
		});
		expect(result.current.dirty).toBe(true);
		expect(result.current.saveFailed).toBe(true);

		rerender({ saved: defaults, settingsRevision: 1 });
		expect(result.current.numericInputs.savingsTarget).toBe("450");
		expect(result.current.dirty).toBe(true);

		rerender({
			saved: { ...defaults, savingsTarget: 450 },
			settingsRevision: 2,
			settingsMutating: true,
		});
		expect(result.current.dirty).toBe(true);

		rerender({
			saved: { ...defaults, savingsTarget: 450 },
			settingsRevision: 3,
		});
		await waitFor(() => expect(result.current.dirty).toBe(false));
		expect(result.current.baseline.savingsTarget).toBe(450);
		expect(result.current.saveFailed).toBe(false);

		rerender({
			saved: { ...defaults, savingsTarget: 900 },
			settingsRevision: 4,
		});
		await waitFor(() =>
			expect(result.current.numericInputs.savingsTarget).toBe("900"),
		);
		expect(result.current.baseline.savingsTarget).toBe(900);
		expect(result.current.dirty).toBe(false);
	});

	it("keeps an all-cards-deselected draft dirty when recovery restores null cards", async () => {
		const card: Account = {
			...financialModelFixture.accounts[5]!,
			id: "card",
			name: "Test card",
			kind: "credit_card",
		};
		const updateSettings = vi.fn(async () => {
			throw new Error("Offline");
		});
		const { result, rerender } = renderHook(
			({ saved }) =>
				useSafeSpendingDraft({
					settings: saved,
					settingsMutating: false,
					settingsRevision: 0,
					updateSettings,
					accounts: [card],
					rules: [],
					savedRules: [],
					displayToday: "2026-11-25",
				}),
			{ initialProps: { saved: defaults } as DraftProps },
		);
		act(() => result.current.selections.toggleAccount(card.id));
		expect(result.current.draft.accountIds).toEqual([]);
		expect(result.current.dirty).toBe(true);
		await act(async () => result.current.save());

		rerender({ saved: defaults, settingsRevision: 1 });
		expect(result.current.draft.accountIds).toEqual([]);
		expect(result.current.dirty).toBe(true);
		expect(result.current.saveFailed).toBe(true);
	});

	it("keeps the dirty draft when the mutation resolves with a null scope-change result", async () => {
		const updateSettings = vi.fn(async () => null);
		const { result } = renderDraft(updateSettings);
		act(() => result.current.setNumericValue("savingsTarget", "450"));
		await act(async () => result.current.save());

		expect(result.current.numericInputs.savingsTarget).toBe("450");
		expect(result.current.dirtyNumericFields.savingsTarget).toBe(true);
		expect(result.current.dirty).toBe(true);
		expect(result.current.saveFailed).toBe(true);
		expect(result.current.saving).toBe(false);
	});
});
