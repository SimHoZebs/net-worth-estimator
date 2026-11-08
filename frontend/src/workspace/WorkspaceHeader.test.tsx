import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RouterContextProvider } from "@tanstack/react-router";
import { createSubjectTestRouter } from "../mocks/testRouter.tsx";
import { pageDefinition } from "./navigation.ts";
import { BreadcrumbSlotProvider } from "./breadcrumbSlot.tsx";
import { WorkspaceTopbar } from "./WorkspaceHeader.tsx";
import { createPortal } from "react-dom";
import { useBreadcrumbSlot } from "./breadcrumbSlot.tsx";

afterEach(cleanup);

function PortalSubject() {
	const slot = useBreadcrumbSlot();
	const breadcrumb = (
		<nav aria-label="Breadcrumb">
			<ol>
				<li>
					<button type="button">Accounts</button>
				</li>
				<li>/</li>
				<li aria-current="page">Everyday checking</li>
			</ol>
		</nav>
	);
	return slot ? createPortal(breadcrumb, slot) : null;
}

async function renderTopbar(
	initialEntry: "/outlook" | "/accounts/checking",
) {
	const isDetail = initialEntry.startsWith("/accounts");
	const router = createSubjectTestRouter({
		subjectRoute: isDetail ? "/accounts/$accountId" : "/outlook",
		subject: null,
		initialEntry,
	});
	await router.load();
	render(
		<RouterContextProvider router={router}>
			<BreadcrumbSlotProvider>
				<WorkspaceTopbar
					page={pageDefinition(isDetail ? "accounts" : "outlook")}
					onOpenNavigation={() => {}}
				/>
				{isDetail ? <PortalSubject /> : null}
			</BreadcrumbSlotProvider>
		</RouterContextProvider>,
	);
}

describe("WorkspaceTopbar", () => {
	it("shows the section trail for top-level pages", async () => {
		await renderTopbar("/outlook");
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		expect(nav.textContent).toContain("Outlook");
	});

	it("portals detail breadcrumbs into the topbar slot", async () => {
		await renderTopbar("/accounts/checking");
		const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
		expect(nav.textContent).toContain("Accounts");
		expect(nav.textContent).toContain("Everyday checking");
	});
});
