import { ArrowUpRight, LockKeyhole } from "lucide-react";

export function WorkspaceFooter({ onMethod }: { onMethod: () => void }) {
	return (
		<footer className="page-footer">
			<span>
				<LockKeyhole size={12} />
				"Server model · local draft recovery"
			</span>
			<button type="button" onClick={onMethod}>
				Planning estimates, not financial advice <ArrowUpRight size={12} />
			</button>
		</footer>
	);
}
