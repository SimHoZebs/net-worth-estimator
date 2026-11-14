import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	FLOW_RANGE_PRESETS,
	flowPresetRange,
} from "../../domain/flowWindow.ts";
import { dateLabel, todayIso } from "../../domain/format.ts";
import { FlowDateRangePicker } from "./FlowDateRangePicker.tsx";

function openDialog(startDate: string, endDate: string, onApply: () => void) {
	render(
		<FlowDateRangePicker
			startDate={startDate}
			endDate={endDate}
			onApply={onApply}
		/>,
	);
	const trigger = screen.getByRole("button", { name: /^Date range: / });
	fireEvent.click(trigger);
	return trigger;
}

describe("FlowDateRangePicker", () => {
	it("names the trigger with the matched preset label", () => {
		const today = todayIso();
		const window = flowPresetRange("this-month", today);
		render(
			<FlowDateRangePicker
				startDate={window.startDate}
				endDate={window.endDate}
				onApply={vi.fn()}
			/>,
		);
		expect(screen.getByText("Date range")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Date range: This month" }),
		).toBeTruthy();
	});

	it("names the trigger with the formatted range for a custom window", () => {
		render(
			<FlowDateRangePicker
				startDate="2026-03-10"
				endDate="2026-03-20"
				onApply={vi.fn()}
			/>,
		);
		const expected = `Date range: ${dateLabel("2026-03-10", true)} – ${dateLabel("2026-03-20", true)}`;
		expect(screen.getByRole("button", { name: expected })).toBeTruthy();
	});

	it("applies a preset range immediately from the presets group", () => {
		const onApply = vi.fn();
		const today = todayIso();
		const window = flowPresetRange("this-month", today);
		openDialog(window.startDate, window.endDate, onApply);
		expect(
			screen.getByRole("dialog", { name: "Choose date range" }),
		).toBeTruthy();
		const group = screen.getByRole("group", {
			name: "Date range presets",
		});
		expect(
			group.querySelectorAll("button").length,
		).toBe(FLOW_RANGE_PRESETS.length);
		for (const preset of FLOW_RANGE_PRESETS) {
			expect(
				screen.getByRole("button", { name: preset.label }),
			).toBeTruthy();
		}
		fireEvent.click(screen.getByRole("button", { name: "Last 3 months" }));
		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply).toHaveBeenCalledWith(
			flowPresetRange("last-3-months", today),
		);
		expect(
			screen.queryByRole("dialog", { name: "Choose date range" }),
		).toBeNull();
	});

	it("stages day clicks in a draft and commits them on Apply", () => {
		const onApply = vi.fn();
		openDialog("2026-03-10", "2026-04-20", onApply);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-15", true) }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-20", true) }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply).toHaveBeenCalledWith({
			startDate: "2026-03-15",
			endDate: "2026-03-20",
		});
		expect(
			screen.queryByRole("dialog", { name: "Choose date range" }),
		).toBeNull();
	});

	it("discards the staged draft on Cancel", () => {
		const onApply = vi.fn();
		openDialog("2026-03-10", "2026-04-20", onApply);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-15", true) }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onApply).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("dialog", { name: "Choose date range" }),
		).toBeNull();
	});

	it("orders an inverted second click so Apply commits start <= end", () => {
		const onApply = vi.fn();
		openDialog("2026-03-10", "2026-04-20", onApply);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-20", true) }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-15", true) }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith({
			startDate: "2026-03-15",
			endDate: "2026-03-20",
		});
	});

	it("opens a same-month window on adjacent months", () => {
		openDialog("2026-11-10", "2026-11-20", vi.fn());
		expect(
			screen.getByRole("region", { name: "November 2026" }),
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "December 2026" }),
		).toBeTruthy();
	});

	it("opens the modal sheet with presets, calendars, and Apply on small screens", () => {
		vi.stubGlobal("matchMedia", (query: string) => ({
			matches: true,
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}));
		const onApply = vi.fn();
		openDialog("2026-03-10", "2026-04-20", onApply);
		expect(
			screen.getByRole("dialog", { name: "Choose date range" }),
		).toBeTruthy();
		expect(
			screen.getByRole("group", { name: "Date range presets" }),
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "March 2026" }),
		).toBeTruthy();
		expect(screen.getByRole("region", { name: "April 2026" })).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-15", true) }),
		);
		fireEvent.click(
			screen.getByRole("button", { name: dateLabel("2026-03-20", true) }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		expect(onApply).toHaveBeenCalledWith({
			startDate: "2026-03-15",
			endDate: "2026-03-20",
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});
});
