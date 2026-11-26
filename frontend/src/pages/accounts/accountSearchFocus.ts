let pending = false;

export function focusAccountSearchOnNextMount(): void {
	pending = true;
}

export function consumeAccountSearchFocus(): boolean {
	if (!pending) return false;
	pending = false;
	return true;
}
