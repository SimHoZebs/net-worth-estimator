import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet.tsx";
import { useModalRegistration } from "../state/modalPresence.ts";
import { stubMatchMedia } from "../mocks/testScope.tsx";
import {
	resetMobileNavigationState,
	useMobileNavigation,
} from "./useMobileNavigation.ts";

beforeEach(() => {
	stubMatchMedia(true);
});

afterEach(() => {
	resetMobileNavigationState();
	cleanup();
	vi.unstubAllGlobals();
});

function Harness() {
	const { open, show } = useMobileNavigation();
	return (
		<>
			<button type="button" data-testid="open-nav-button" onClick={show}>
				Open nav
			</button>
			<span data-testid="nav-open">{String(open)}</span>
		</>
	);
}

/** Any modal dialog registers presence; the Sheet below stands in for one. */
function UpperSheet() {
	useModalRegistration(true);
	return (
		<Sheet open onOpenChange={() => {}}>
			<SheetContent side="right">
				<SheetTitle>Upper sheet</SheetTitle>
				<p>Upper content</p>
			</SheetContent>
		</Sheet>
	);
}

describe("mobile navigation guard", () => {
	it("refuses to open above an open dialog", () => {
		render(
			<>
				<UpperSheet />
				<Harness />
			</>,
		);
		// The open Sheet makes the background inert, so the role query
		// cannot see the hamburger; the test id still dispatches show().
		fireEvent.click(screen.getByTestId("open-nav-button"));
		expect(screen.getByTestId("nav-open").textContent).toBe("false");
	});

	it("opens when no dialog is present", () => {
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "Open nav" }));
		expect(screen.getByTestId("nav-open").textContent).toBe("true");
	});

	it("keeps the sheet open when the layout remounts", () => {
		const boot = render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "Open nav" }));
		expect(screen.getByTestId("nav-open").textContent).toBe("true");
		boot.unmount();
		render(<Harness />);
		expect(screen.getByTestId("nav-open").textContent).toBe("true");
	});

	it("dismisses at the desktop breakpoint and stays closed on return to mobile", () => {
		let mobile = true;
		const listeners = new Set<() => void>();
		vi.stubGlobal("matchMedia", () => ({
			get matches() {
				return mobile;
			},
			addEventListener: (_: string, listener: () => void) =>
				listeners.add(listener),
			removeEventListener: (_: string, listener: () => void) =>
				listeners.delete(listener),
		}));
		render(<Harness />);
		fireEvent.click(screen.getByRole("button", { name: "Open nav" }));
		expect(screen.getByTestId("nav-open").textContent).toBe("true");
		act(() => {
			mobile = false;
			for (const listener of listeners) listener();
		});
		expect(screen.getByTestId("nav-open").textContent).toBe("false");
		act(() => {
			mobile = true;
			for (const listener of listeners) listener();
		});
		expect(screen.getByTestId("nav-open").textContent).toBe("false");
	});
});
