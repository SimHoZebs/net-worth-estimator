import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
});
