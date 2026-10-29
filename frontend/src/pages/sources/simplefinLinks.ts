// Public entry points from the SimpleFIN Bridge user and developer guides.
export const simplefinLinks = {
	home: "https://bridge.simplefin.org/",
	createToken: "https://beta-bridge.simplefin.org/my-account/tokens/create",
	// The public host currently redirects subpages to the beta host's home page.
	// Link this resource on the serving host so its path is preserved.
	institutions: "https://beta-bridge.simplefin.org/search-institutions",
} as const;
