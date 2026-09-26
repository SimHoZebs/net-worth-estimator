import { ArrowUpRight, LockKeyhole } from "lucide-react";

export function WorkspaceFooter({
	serverMode,
	onMethod,
}: {
	serverMode: boolean;
	onMethod: () => void;
}) {
	return (
		<footer className="page-footer">
			<span>
				<LockKeyhole size={12} />
				{serverMode
					? "Server model · local draft recovery"
					: "Private to this browser"}
			</span>
			<button type="button" onClick={onMethod}>
				Planning estimates, not financial advice <ArrowUpRight size={12} />
			</button>
		</footer>
	);
}
