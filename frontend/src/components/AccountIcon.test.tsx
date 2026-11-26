import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountIcon, AccountLabel } from "./AccountIcon.tsx";

const base = {
	id: "checking",
	kind: "cash" as const,
	color: null,
};

describe("AccountIcon", () => {
	it("keeps the exact generic glyph, dimensions, and colors without a logo key", () => {
		const { container } = render(<AccountIcon account={base} />);
		const span = container.firstElementChild as HTMLElement;
		const svg = container.querySelector("svg") as SVGElement;
		expect(svg.classList.contains("lucide-wallet")).toBe(true);
		expect(svg.getAttribute("width")).toBe("19");
		expect(svg.getAttribute("height")).toBe("19");
		expect(svg.getAttribute("stroke-width")).toBe("1.7");
		expect(svg.getAttribute("aria-hidden")).toBe("true");
		expect(span.className).not.toContain("relative");
		expect(container.querySelector("img")).toBeNull();
	});

	it("keeps savings and kind behavior with a logo key present", () => {
		const { container } = render(
			<AccountIcon
				account={{ ...base, id: "savings", recognizedBusinessKey: "chase" }}
			/>,
		);
		expect(container.querySelector("svg.lucide-piggy-bank")).not.toBeNull();
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"/v1/assets/business-logos/chase",
		);
		const colored = render(
			<AccountIcon account={{ ...base, color: "#4287f5" }} size="lg" />,
		);
		const coloredSvg = colored.container.querySelector("svg") as SVGElement;
		expect(coloredSvg.getAttribute("width")).toBe("24");
		expect(
			(
				colored.container.firstElementChild as HTMLElement
			).style.getPropertyValue("--account-color"),
		).toBe("#4287f5");
	});

	it("shows the generic glyph while the logo loads, then only the logo", () => {
		const { container } = render(
			<AccountIcon account={{ ...base, recognizedBusinessKey: "paypal" }} />,
		);
		const image = container.querySelector("img") as HTMLImageElement;
		expect(image.getAttribute("alt")).toBe("");
		expect(image.getAttribute("aria-hidden")).toBe("true");
		expect(image.getAttribute("width")).toBe("19");
		expect(image.getAttribute("height")).toBe("19");
		expect(image.className).toContain("opacity-0");
		expect(container.querySelector("svg.lucide-wallet")).not.toBeNull();

		fireEvent.load(image);
		expect(container.querySelector("svg")).toBeNull();
		expect(container.querySelector("img")?.className).not.toContain(
			"opacity-0",
		);
	});

	it("falls back on asset failure and resets when the key changes", () => {
		const { container, rerender } = render(
			<AccountIcon account={{ ...base, recognizedBusinessKey: "venmo" }} />,
		);
		fireEvent.error(container.querySelector("img") as HTMLImageElement);
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("svg.lucide-wallet")).not.toBeNull();

		rerender(
			<AccountIcon account={{ ...base, recognizedBusinessKey: "klarna" }} />,
		);
		const next = container.querySelector("img") as HTMLImageElement;
		expect(next.getAttribute("src")).toBe("/v1/assets/business-logos/klarna");
		expect(container.querySelector("svg.lucide-wallet")).not.toBeNull();
		fireEvent.load(next);
		expect(container.querySelector("svg")).toBeNull();
	});

	it("resets a loaded logo when the key changes", () => {
		const { container, rerender } = render(
			<AccountIcon account={{ ...base, recognizedBusinessKey: "chase" }} />,
		);
		fireEvent.load(container.querySelector("img") as HTMLImageElement);
		expect(container.querySelector("svg")).toBeNull();
		rerender(
			<AccountIcon account={{ ...base, recognizedBusinessKey: "discover" }} />,
		);
		expect(container.querySelector("svg.lucide-wallet")).not.toBeNull();
	});

	it("keeps account labels and their name semantics unchanged", () => {
		const { container } = render(
			<AccountLabel
				account={{ ...base, name: "Checking", recognizedBusinessKey: "chase" }}
			/>,
		);
		expect(container.textContent).toContain("Checking");
		expect(container.textContent).toContain("Cash");
		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"/v1/assets/business-logos/chase",
		);
	});
});
