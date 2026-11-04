import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu.tsx";

function item(overrides: Partial<ActionMenuItem> = {}): ActionMenuItem {
	return {
		id: "run",
		label: "Run action",
		onSelect: vi.fn(),
		...overrides,
	};
}

describe("ActionMenu", () => {
	it("opens from the three-dot trigger and runs the selected item", () => {
		const onSelect = vi.fn();
		render(
			<ActionMenu menuLabel="Thing actions" items={[item({ onSelect })]} />,
		);
		const trigger = screen.getByRole("button", { name: "More options" });
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("menu", { name: "Thing actions" })).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "Run action" }));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("renders a checked item as a menuitemcheckbox", () => {
		render(
			<ActionMenu
				menuLabel="Thing actions"
				items={[item({ checked: false })]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "More options" }));
		const checkbox = screen.getByRole("menuitemcheckbox", {
			name: "Run action",
		});
		expect(checkbox.getAttribute("aria-checked")).toBe("false");
	});

	it("closes on Escape and returns focus to the trigger", () => {
		render(<ActionMenu menuLabel="Thing actions" items={[item()]} />);
		const trigger = screen.getByRole("button", { name: "More options" });
		fireEvent.click(trigger);
		expect(screen.getByRole("menu")).toBeTruthy();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("closes from the outside-click backdrop", () => {
		render(<ActionMenu menuLabel="Thing actions" items={[item()]} />);
		const trigger = screen.getByRole("button", { name: "More options" });
		fireEvent.click(trigger);
		fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("renders nothing when no actions are available", () => {
		const { container } = render(
			<ActionMenu menuLabel="Thing actions" items={[]} />,
		);
		expect(container.innerHTML).toBe("");
	});
});
