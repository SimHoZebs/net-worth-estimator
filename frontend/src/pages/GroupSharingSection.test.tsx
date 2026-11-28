import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../domain/model.ts";
import { financialModelFixture } from "../mocks/financialModel.ts";
import type { SharingPolicy, SharingPolicyInput } from "./sharingApi.ts";
import { GroupSharingSection } from "./GroupSharingSection.tsx";

interface PreviewInput {
	accountIds: string[];
	startDate?: string;
	endDate?: string;
}

const sharingState = vi.hoisted(() => ({
	policy: null as SharingPolicy | null,
	accounts: [] as Account[],
	previewInputs: [] as Array<PreviewInput | null>,
	mutateAsync: vi.fn(),
}));

vi.mock("../state/savedState.ts", () => ({
	useSavedAccounts: () => sharingState.accounts,
}));
vi.mock("../state/sharing.ts", () => ({
	useSharingPolicy: () => ({
		data: sharingState.policy,
		isPending: false,
		isError: false,
	}),
	useSharingGrants: () => ({ data: [] }),
	useSetSharingPolicy: () => ({ mutateAsync: sharingState.mutateAsync }),
	useSharingPreview: (_groupId: string, input: PreviewInput | null) => {
		sharingState.previewInputs.push(input);
		return {
			data: input
				? {
						...input,
						enabled: false,
						eligibleTransactions: 2,
						memberCount: 1,
					}
				: null,
			isPending: false,
			isError: false,
			error: null,
		};
	},
	refreshSharingViewsFor: vi.fn(),
}));
vi.mock("../state/notifications.ts", () => ({
	notifyError: vi.fn(),
	notifySuccess: vi.fn(),
}));
vi.mock("./sharingApi.ts", () => ({
	mintShareRequestId: () => "request-id",
	revokeSharedTransaction: vi.fn(),
}));
vi.mock("../components/AccountToggle.tsx", () => ({
	AccountToggle: ({
		account,
		checked,
		disabled,
		onToggle,
	}: {
		account: Account;
		checked: boolean;
		disabled: boolean;
		onToggle: () => void;
	}) => (
		<button
			type="button"
			aria-pressed={checked}
			disabled={disabled}
			onClick={onToggle}
		>
			{account.name}
		</button>
	),
}));

function policy(overrides: Partial<SharingPolicy> = {}): SharingPolicy {
	return {
		ownerUserId: "owner",
		groupId: "group",
		enabled: true,
		accountIds: ["checking"],
		startDate: "2026-01-01",
		version: 1,
		updatedAt: 1,
		...overrides,
	};
}

function settlePreview() {
	act(() => vi.advanceTimersByTime(350));
}

function selectChecking() {
	fireEvent.click(
		screen.getByRole("button", {
			name: financialModelFixture.accounts[0]!.name,
		}),
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
	sharingState.policy = null;
	sharingState.accounts = [financialModelFixture.accounts[0]!];
	sharingState.previewInputs = [];
	sharingState.mutateAsync.mockReset();
	sharingState.mutateAsync.mockResolvedValue(policy({ enabled: true }));
});

afterEach(() => vi.useRealTimers());

describe("group sharing end-date choice", () => {
	it("requires a new draft to choose No end date and omits it from the save", async () => {
		render(<GroupSharingSection groupId="group" />);
		const turnOn = screen.getByRole("button", {
			name: "Turn on sharing",
		}) as HTMLButtonElement;
		const noEnd = screen.getByRole("checkbox", { name: "No end date" });
		const until = screen.getByLabelText("Share until") as HTMLInputElement;

		expect(turnOn.disabled).toBe(true);
		expect(noEnd.getAttribute("aria-checked")).toBe("false");
		expect(until.disabled).toBe(false);

		selectChecking();
		settlePreview();
		expect(sharingState.previewInputs.at(-1)).toBeNull();
		expect(turnOn.disabled).toBe(true);

		fireEvent.click(noEnd);
		expect(until.disabled).toBe(true);
		settlePreview();
		expect(sharingState.previewInputs.at(-1)).toEqual({
			accountIds: ["checking"],
			startDate: "2026-11-27",
			endDate: undefined,
		});
		expect(screen.getByText(/with no end/)).toBeTruthy();

		await act(async () => fireEvent.click(turnOn));
		const input = sharingState.mutateAsync.mock.calls[0]![0] as {
			input: SharingPolicyInput;
		};
		expect(input.input).toEqual({
			enabled: true,
			accountIds: ["checking"],
			startDate: "2026-11-27",
		});
		expect(input.input).not.toHaveProperty("endDate");
	});

	it("previews and saves an explicitly chosen date", async () => {
		render(<GroupSharingSection groupId="group" />);
		selectChecking();
		fireEvent.change(screen.getByLabelText("Share until"), {
			target: { value: "2026-12-31" },
		});
		settlePreview();

		expect(sharingState.previewInputs.at(-1)).toEqual({
			accountIds: ["checking"],
			startDate: "2026-11-27",
			endDate: "2026-12-31",
		});
		expect(screen.getByText(/to 2026-12-31/)).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "Turn on sharing" })),
		);
		expect(sharingState.mutateAsync.mock.calls[0]![0].input).toMatchObject({
			enabled: true,
			endDate: "2026-12-31",
		});
	});

	it("loads a saved open-ended choice and keeps apply eligibility when switching modes", async () => {
		sharingState.policy = policy();
		render(<GroupSharingSection groupId="group" />);
		const noEnd = screen.getByRole("checkbox", { name: "No end date" });
		const until = screen.getByLabelText("Share until") as HTMLInputElement;
		const save = screen.getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;

		expect(noEnd.getAttribute("aria-checked")).toBe("true");
		expect(until.disabled).toBe(true);
		settlePreview();
		expect(sharingState.previewInputs.at(-1)).toEqual({
			accountIds: ["checking"],
			startDate: "2026-01-01",
			endDate: undefined,
		});

		fireEvent.click(noEnd);
		expect(until.disabled).toBe(false);
		expect(save.disabled).toBe(true);
		fireEvent.change(until, { target: { value: "2026-12-31" } });
		expect(save.disabled).toBe(false);
		await act(async () => fireEvent.click(save));
		expect(sharingState.mutateAsync.mock.calls[0]![0].input).toEqual({
			enabled: true,
			accountIds: ["checking"],
			startDate: "2026-01-01",
			endDate: "2026-12-31",
		});
	});

	it("loads a saved dated choice without selecting No end date", () => {
		sharingState.policy = policy({ endDate: "2026-12-31" });
		render(<GroupSharingSection groupId="group" />);
		expect(
			screen
				.getByRole("checkbox", { name: "No end date" })
				.getAttribute("aria-checked"),
		).toBe("false");
		expect(
			(screen.getByLabelText("Share until") as HTMLInputElement).value,
		).toBe("2026-12-31");
	});
});
