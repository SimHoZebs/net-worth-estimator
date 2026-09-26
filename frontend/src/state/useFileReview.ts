import { useState } from "react";
import { MAX_IMPORT_BYTES, readImportFile } from "../api/modelImport.ts";

export function useFileReview<T>({
	parse,
	oversizedMessage,
	blockedMessage = null,
}: {
	parse: (text: string) => T | Error;
	oversizedMessage: string;
	blockedMessage?: string | null;
}) {
	const [candidate, setCandidate] = useState<T | null>(null);
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const readFile = async (file: File) => {
		setError(null);
		if (file.size > MAX_IMPORT_BYTES) {
			setError(oversizedMessage);
			return;
		}
		if (blockedMessage) {
			setError(blockedMessage);
			return;
		}
		setReading(true);
		const text = await readImportFile({ file, oversizedMessage });
		setReading(false);
		if (text instanceof Error) {
			setError(text.message);
			return;
		}
		const parsed = parse(text);
		if (parsed instanceof Error) {
			setError(parsed.message);
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
