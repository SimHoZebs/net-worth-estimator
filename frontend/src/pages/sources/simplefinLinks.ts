// Public entry points from the SimpleFIN Bridge user and developer guides.
export const simplefinLinks = {
	home: "https://bridge.simplefin.org/",
	createToken: "https://beta-bridge.simplefin.org/my-account/tokens/create",
	// The public host currently redirects subpages to the beta host's home page.
	// Link these resources on the serving host so their paths are preserved.
	institutions: "https://beta-bridge.simplefin.org/search-institutions",
	security: "https://beta-bridge.simplefin.org/info/security",
} as const;
