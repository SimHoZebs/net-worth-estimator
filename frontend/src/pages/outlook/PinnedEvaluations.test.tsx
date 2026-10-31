import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OtherEvaluation } from "@/domain/result.ts";
import { financialModelFixture } from "@/mocks/financialModel.ts";
import { evaluationFixture, projectionFixture } from "@/mocks/projection.ts";
import { PinnedEvaluations } from "@/pages/outlook/PinnedEvaluations.tsx";
import {
	useSavedAccounts,
	useSavedEvaluations,
	useSavedStartDate,
	useSavedTransactions,
} from "@/state/savedRows.ts";
import { usePinnedEvaluations } from "@/state/pinnedEvaluations.ts";
import { useRemoteProjection } from "@/state/useRemoteProjection.ts";
import { useServerStatus } from "@/state/workspaceResources.ts";

vi.mock("@/state/savedRows.ts", () => ({
	useSavedAccounts: vi.fn(),
	useSavedTransactions: vi.fn(),
	useSavedStartDate: vi.fn(),
	useSavedEvaluations: vi.fn(),
}));

vi.mock("@/state/pinnedEvaluations.ts", () => ({
	usePinnedEvaluations: vi.fn(),
}));

vi.mock("@/state/useRemoteProjection.ts", () => ({
	useRemoteProjection: vi.fn(),
}));

vi.mock("@/state/workspaceResources.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/state/workspaceResources.ts")>()),
	useServerStatus: vi.fn(),
}));

const mockedAccounts = vi.mocked(useSavedAccounts);
const mockedTransactions = vi.mocked(useSavedTransactions);
const mockedStartDate = vi.mocked(useSavedStartDate);
const mockedEvaluations = vi.mocked(useSavedEvaluations);
const mockedPins = vi.mocked(usePinnedEvaluations);
const mockedProjection = vi.mocked(useRemoteProjection);
const mockedStatus = vi.mocked(useServerStatus);

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	mockedAccounts.mockReturnValue(financialModelFixture.accounts);
	mockedTransactions.mockReturnValue(financialModelFixture.transactions);
	mockedStartDate.mockReturnValue(financialModelFixture.startDate);
	mockedEvaluations.mockReturnValue(financialModelFixture.evaluations);
	mockedStatus.mockReturnValue({ data: { readOnly: false } } as ReturnType<
		typeof useServerStatus
	>);
});

const funding: OtherEvaluation = {
	id: "funding",
	name: "Test evaluation",
	type: "postingFulfillment",
	enabled: true,
	status: "satisfied",
	goal: null,
	outcomeDate: null,
	outcomeText: "Test outcome",
	qualifier: null,
	progress: null,
	postingIds: null,
};

function mockState(input: {
	projection?: ReturnType<typeof projectionFixture> | null;
	range?: {
		points: never[];
		count: number;
		evaluationSuccess: Record<string, number>;
		failureShare: number;
	} | null;
	pinnedIds?: string[] | null;
	toggle?: ReturnType<typeof vi.fn>;
	readOnly?: boolean;
}) {
	const toggle = input.toggle ?? vi.fn();
	mockedPins.mockReturnValue({
		ids: input.pinnedIds === undefined ? [funding.id] : input.pinnedIds,
		toggle,
		loading: false,
		error: null,
		refresh: async () => {},
	} as unknown as ReturnType<typeof usePinnedEvaluations>);
	mockedProjection.mockReturnValue({
		base:
			input.projection ?? projectionFixture({ otherEvaluations: [funding] }),
		range: input.range ?? null,
		status: "success",
		isPlaceholderData: false,
		loading: false,
	} as ReturnType<typeof useRemoteProjection>);
	mockedStatus.mockReturnValue({
		data: { readOnly: input.readOnly ?? false },
	} as ReturnType<typeof useServerStatus>);
	return { toggle };
}

describe("pinned evaluation cards", () => {
	it.each([null, [], ["unknown"]])(
		"has no fallback card for pins %j",
		(pinnedIds) => {
			mockState({
				pinnedIds,
				projection: projectionFixture({ otherEvaluations: [funding] }),
			});
			const view = render(<PinnedEvaluations />);
			expect(view.container.childElementCount).toBe(0);
		},
	);

	it("changes the selected pin and removes it when unpinned", () => {
		const { toggle } = mockState({});
		const view = render(<PinnedEvaluations />);
		const region = view.getByRole("region", { name: funding.name });
		const button = within(region).getByRole("button", { pressed: true });
		expect(button.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(button);
		expect(toggle).toHaveBeenCalledWith(funding.id);
		mockedPins.mockReturnValue({
			ids: [],
			toggle,
			loading: false,
			error: null,
			refresh: async () => {},
		} as unknown as ReturnType<typeof usePinnedEvaluations>);
		view.rerender(<PinnedEvaluations />);
		expect(view.container.childElementCount).toBe(0);
	});

	it("disables pin changes in read-only mode", () => {
		const { toggle } = mockState({ readOnly: true });
		const view = render(<PinnedEvaluations />);
		const button = view.getByRole("button", { pressed: true });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(button);
		expect(toggle).not.toHaveBeenCalled();
	});

	it.each(financialModelFixture.evaluations)(
		"shows and pins the configured $kind target without an evidence action",
		(evaluation) => {
			const result = evaluationFixture({ evaluation });
			const { toggle } = mockState({
				projection: projectionFixture({ evaluations: [result] }),
				range: {
					points: [],
					count: 400,
					evaluationSuccess: { [evaluation.id]: 0.75 },
					failureShare: 0,
				},
				pinnedIds: [evaluation.id],
			});
			const view = render(<PinnedEvaluations />);
			const card = within(view.getByRole("region", { name: evaluation.name }));
			const progress = card.getByRole("progressbar", { name: evaluation.name });
			expect(Number(progress.getAttribute("aria-valuenow"))).toBe(
				Math.round(
					Math.min(
						100,
						Math.max(0, (result.current / evaluation.target) * 100),
					),
				),
			);
			expect(card.queryByRole("button", { name: /Evidence/ })).toBeNull();
			expect(card.queryByText(/of modeled scenarios/)).toBeNull();
			fireEvent.click(
				card.getByRole("button", {
					name: `Unpin ${evaluation.name} from Outlook`,
				}),
			);
			expect(toggle).toHaveBeenCalledWith(evaluation.id);
			mockedPins.mockReturnValue({
				ids: [],
				toggle,
				loading: false,
				error: null,
				refresh: async () => {},
			} as unknown as ReturnType<typeof usePinnedEvaluations>);
			view.rerender(<PinnedEvaluations />);
			expect(view.container.childElementCount).toBe(0);
		},
	);
});
