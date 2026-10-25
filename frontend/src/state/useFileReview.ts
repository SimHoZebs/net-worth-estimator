import { useState } from "react";
import { MAX_IMPORT_BYTES, readImportFile } from "../api/modelImport.ts";

export function useFileReview<T>({
	parse,
	oversizedMessage,
	blockedMessage = null,
	onError,
}: {
	parse: (text: string) => T | Error;
	oversizedMessage: string;
	blockedMessage?: string | null;
	onError?: (message: string) => void;
}) {
	const [candidate, setCandidate] = useState<T | null>(null);
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fail = (message: string) => {
		setError(message);
		onError?.(message);
	};
	const readFile = async (file: File) => {
		setError(null);
		if (file.size > MAX_IMPORT_BYTES) {
			fail(oversizedMessage);
			return;
		}
		if (blockedMessage) {
			fail(blockedMessage);
			return;
		}
		setReading(true);
		const text = await readImportFile({ file, oversizedMessage });
		setReading(false);
		if (text instanceof Error) {
			fail(text.message);
			return;
		}
		const parsed = parse(text);
		if (parsed instanceof Error) {
			fail(parsed.message);
			return;
		}
		setCandidate(parsed);
	};
	return {
		candidate,
		reading,
		error,
		setError,
		readFile,
		clearCandidate: () => setCandidate(null),
	};
}
