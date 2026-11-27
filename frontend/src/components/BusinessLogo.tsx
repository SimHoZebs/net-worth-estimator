import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils.ts";
import { businessLogoURL } from "../lib/businessLogos.ts";

/**
 * Decorative business mark with the caller's generic glyph as its loading and
 * error fallback. The parent owns positioning, color, and dimensions.
 */
export function BusinessLogo({
	businessKey,
	fallback,
	size,
}: {
	businessKey?: string | null;
	fallback: ReactNode;
	size: number;
}) {
	const logoURL = businessLogoURL(businessKey);
	// A key change starts a fresh load: both outcomes are tagged with the key
	// they belong to, so an old failure never hides a newly recognized logo.
	const [assetState, setAssetState] = useState<{
		key: string;
		status: "loaded" | "failed";
	} | null>(null);
	const status =
		businessKey && assetState?.key === businessKey
			? assetState.status
			: "loading";
	const showLogo = Boolean(businessKey) && status === "loaded";
	return (
		<>
			{businessKey && logoURL && status !== "failed" ? (
				<img
					src={logoURL}
					alt=""
					aria-hidden="true"
					width={size}
					height={size}
					className={cn(
						"object-contain dark:invert",
						showLogo ? undefined : "pointer-events-none absolute opacity-0",
					)}
					onLoad={() => setAssetState({ key: businessKey, status: "loaded" })}
					onError={() => setAssetState({ key: businessKey, status: "failed" })}
				/>
			) : null}
			{showLogo ? null : fallback}
		</>
	);
}
