import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "../components/Drawer.tsx";
import { useMobileNavigation } from "./useMobileNavigation.ts";

beforeEach(() => {
	vi.stubGlobal("matchMedia", (query: string) => ({
		matches: true,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	}));
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function Harness() {
	const { open, show } = useMobileNavigation();
	return (
		<>
			<button type="button" onClick={show}>
				Open nav
			</button>
			<span data-testid="nav-open">{String(open)}</span>
		</>
	);
}

describe("mobile navigation guard", () => {
	it("refuses to open above an open dialog", () => {
		render(
			<>
				<Drawer
					side="right"
					open
					label="Upper sheet"
					onClose={() => {}}
					appearance={{ title: "Upper" }}
				>
					<p>Upper content</p>
				</Drawer>
				<Harness />
			</>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open nav" }));
		expect(screen.getByTestId("nav-open").textContent).toBe("false");
	});

	it("opens when no dialog is present", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "Open nav" }));
		expect(screen.getByTestId("nav-open").textContent).toBe("true");
	});
});
