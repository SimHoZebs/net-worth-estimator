import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceHeading, WorkspaceTopbar } from "./WorkspaceHeader.tsx";
import { useWorkspaceNavigation } from "./useWorkspaceNavigation.ts";

beforeEach(() => window.history.replaceState(null, "", "#accounts"));
afterEach(() => {
	cleanup();
	window.history.replaceState(null, "", "#accounts");
});

function Harness({ recovery = false }: { recovery?: boolean }) {
	const navigation = useWorkspaceNavigation();
	return (
		<>
			<WorkspaceTopbar
				page={navigation.currentPage}
				onOpenNavigation={() => {}}
			/>
			{!recovery && (
				<WorkspaceHeading
					page={navigation.currentPage}
					headingRef={navigation.headingRef}
				/>
			)}
			<button onClick={() => navigation.pushHash("#accounts/checking")}>
				Evidence
			</button>
			<button
				onClick={() =>
					navigation.pushHash("#accounts/checking/edit", {
						kind: "account",
						id: "checking",
					})
				}
			>
				Edit evidence
			</button>
			<button onClick={() => navigation.pushHash("#accounts/new")}>
				New account
			</button>
			<button onClick={() => navigation.navigate("transactions")}>
				Transactions
			</button>
			<output data-testid="return-to">
				{JSON.stringify(navigation.returnTo)}
			</output>
			<output data-testid="page">{navigation.page}</output>
		</>
	);
}

it("renders one declarative page title and leaves focus alone on overlay navigation", async () => {
	render(<Harness />);
	expect(document.title).toBe("Accounts · Waypoint");
	const evidence = screen.getByRole("button", { name: "Evidence" });
	evidence.focus();
	fireEvent.click(evidence);
	await waitFor(() => expect(window.location.hash).toBe("#accounts/checking"));
	expect(document.activeElement).toBe(evidence);
	fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
	await waitFor(() => expect(document.title).toBe("Transactions · Waypoint"));
	await waitFor(() =>
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { level: 1 }),
		),
	);
	expect(document.head.querySelectorAll("title")).toHaveLength(1);
});

it("scopes the editor return target to its history entry and clears it in ordinary navigation", async () => {
	render(<Harness />);
	fireEvent.click(screen.getByRole("button", { name: "Edit evidence" }));
	expect(screen.getByTestId("return-to").textContent).toBe(
		'{"kind":"account","id":"checking"}',
	);
	const editorState: unknown = window.history.state;
	fireEvent.click(screen.getByRole("button", { name: "New account" }));
	expect(screen.getByTestId("return-to").textContent).toBe("null");
	// Restore the saved entry as the browser does on Back/Forward.
	act(() => {
		window.history.replaceState(editorState, "", "#accounts/checking/edit");
		window.dispatchEvent(new HashChangeEvent("hashchange"));
	});
	expect(screen.getByTestId("return-to").textContent).toBe(
		'{"kind":"account","id":"checking"}',
	);
	act(() => {
		window.history.replaceState(editorState, "", "#transactions");
		window.dispatchEvent(new HashChangeEvent("hashchange"));
	});
	expect(screen.getByTestId("return-to").textContent).toBe("null");
});

it("updates the title in recovery chrome without the normal page heading", async () => {
	render(<Harness recovery />);
	expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
	expect(document.title).toBe("Accounts · Waypoint");
	fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
	await waitFor(() => expect(document.title).toBe("Transactions · Waypoint"));
	expect(document.head.querySelectorAll("title")).toHaveLength(1);
});
