import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildReport,
	installClientErrors,
	reportClientError,
} from "./clientErrors.ts";

describe("client error beacon", () => {
	const sendBeacon = vi.fn(() => true);

	beforeEach(() => {
		vi.stubGlobal("navigator", { ...navigator, sendBeacon });
		sendBeacon.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("bounds the message, stack, and path", () => {
		const error = new Error("x".repeat(5000));
		error.stack = "s".repeat(9000);
		const report = buildReport("error", error, "/".repeat(600));
		expect(report.message.length).toBe(1024);
		expect(report.stack?.length).toBe(8192);
		expect(report.path.length).toBe(512);
		expect(report.source).toBe("error");
	});

	it("falls back for non-error rejection reasons", () => {
		expect(buildReport("unhandledrejection", "plain").message).toBe("plain");
		expect(buildReport("unhandledrejection", 42).message).toBe("42");
	});

	it("posts a json beacon on reportClientError", () => {
		reportClientError({ message: "boom", source: "error", path: "/ledger" });
		expect(sendBeacon).toHaveBeenCalledTimes(1);
		const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
		expect(url).toBe("/v1/client-errors");
		expect(blob.type).toBe("application/json");
	});

	it("never throws when the beacon transport fails", () => {
		sendBeacon.mockImplementationOnce(() => {
			throw new Error("no beacon");
		});
		expect(() =>
			reportClientError({ message: "boom", source: "error", path: "/" }),
		).not.toThrow();
	});

	it("installs window listeners that report errors", async () => {
		installClientErrors();
		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "render boom",
				error: new Error("render boom"),
			}),
		);
		expect(sendBeacon).toHaveBeenCalledTimes(1);
		const [, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
		const text = await blob.text();
		expect(text).toContain("render boom");
		expect(text).toContain('"source":"error"');
	});
});
