import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { PostingAmount } from "./PostingAmount";

describe("PostingAmount", () => {
	it("formats fixed numeric amounts as currency", () => {
		const html = renderToStaticMarkup(<PostingAmount arithmetic="3200" />);
		expect(html).toContain("$3,200");
		expect(html).not.toContain("Calculated");
	});

	it("shows dynamic amount calculations verbatim", () => {
		const html = renderToStaticMarkup(
			<PostingAmount arithmetic="salary * 0.22" />,
		);
		expect(html).toContain("salary * 0.22");
		expect(html).toContain("Calculated");
	});

	it("presents arbitrary resolver structure without serializing it", () => {
		const posting = makePosting({
			id: "custom",
			amount: {
				resolver: "external-pipeline",
				config: {
					strategyId: "primary",
					resolvers: [
						{
							resolver: "weighted-step",
							config: { weight: 0.25 },
						},
					],
				},
				inputs: {
					balance: {
						source: "provider",
						provider: "remote-value",
						arguments: { id: "balance" },
					},
				},
			},
		});
		const html = renderToStaticMarkup(
			<PostingAmount posting={posting} showDetails />,
		);

		expect(html).toContain("External pipeline calculation");
		expect(html).toContain("Weighted step calculation");
		expect(html).toContain("Strategy ID");
		expect(html).toContain("remote-value");
		expect(html).not.toContain("&quot;resolver&quot;");
	});
});
