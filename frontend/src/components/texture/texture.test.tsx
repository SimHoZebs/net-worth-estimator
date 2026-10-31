import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextureDefs } from "./TextureDefs.tsx";
import { TextureSprite } from "./TextureSprite.tsx";
import {
	seriesTexture,
	textureFill,
	textureId,
	toneToken,
	TEXTURE_PATTERNS,
	TEXTURE_TONES,
} from "./texture.ts";

describe("texture contract", () => {
	it("exposes four tones and four patterns", () => {
		expect(TEXTURE_TONES).toEqual(["sage", "tan", "blue", "plum"]);
		expect(TEXTURE_PATTERNS).toEqual(["solid", "stripes", "dots", "hatch"]);
	});
	it("maps tones to chart tokens", () => {
		expect(toneToken("sage")).toBe("var(--chart-series-1)");
		expect(toneToken("tan")).toBe("var(--chart-series-2)");
		expect(toneToken("blue")).toBe("var(--chart-series-3)");
		expect(toneToken("plum")).toBe("var(--chart-series-4)");
	});
	it("keeps the first four series solid in tone order", () => {
		expect([0, 1, 2, 3].map(seriesTexture)).toEqual([
			{ tone: "sage", pattern: "solid" },
			{ tone: "tan", pattern: "stripes" },
			{ tone: "blue", pattern: "dots" },
			{ tone: "plum", pattern: "hatch" },
		]);
	});
	it("changes pattern before repeating a tone-plus-pattern pair", () => {
		const combos = Array.from({ length: 16 }, (_, index) => {
			const { tone, pattern } = seriesTexture(index);
			return `${tone}:${pattern}`;
		});
		expect(new Set(combos).size).toBe(16);
		expect(seriesTexture(4)).toEqual({ tone: "sage", pattern: "stripes" });
		expect(seriesTexture(5)).toEqual({ tone: "tan", pattern: "dots" });
	});
	it("resolves solid fills to tokens and textures to shared ids", () => {
		expect(textureFill("sage", "solid")).toBe("var(--chart-series-1)");
		expect(textureFill("tan", "hatch")).toBe("url(#wp-tex-tan-hatch)");
		expect(textureId("plum", "dots")).toBe("wp-tex-plum-dots");
	});
});

describe("texture defs", () => {
	it("renders one pattern per entry with motif geometry", () => {
		render(
			<svg>
				<TextureDefs
					entries={[
						{
							id: "test-tail",
							background: null,
							mark: "var(--line-strong)",
							markOpacity: 1,
							motif: "stripes",
						},
						{
							id: "test-withdrawals",
							background: "var(--chart-band)",
							mark: "var(--primary)",
							markOpacity: 0.5,
							motif: "dots",
						},
					]}
				/>
			</svg>,
		);
		const tail = document.getElementById("test-tail");
		const withdrawals = document.getElementById("test-withdrawals");
		expect(tail?.tagName).toBe("pattern");
		expect(tail?.querySelector("line")).toBeTruthy();
		expect(tail?.querySelector("rect")).toBeNull();
		expect(withdrawals?.querySelector("rect")).toBeTruthy();
		expect(withdrawals?.querySelector("circle")).toBeTruthy();
	});
	it("sprites every tone-plus-pattern pair the stack can reference", () => {
		const { container } = render(<TextureSprite />);
		const patterns = container.querySelectorAll("pattern");
		expect(patterns).toHaveLength(12);
		for (const tone of TEXTURE_TONES) {
			for (const pattern of TEXTURE_PATTERNS) {
				if (pattern === "solid") continue;
				expect(
					container.querySelector(`#wp-tex-${tone}-${pattern}`),
					`${tone}:${pattern}`,
				).toBeTruthy();
			}
		}
		expect(screen.queryByRole("img")).toBeNull();
	});
});
