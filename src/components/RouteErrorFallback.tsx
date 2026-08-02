import { isRouteErrorResponse, useRouteError } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RouteErrorFallback() {
	const error = useRouteError();
	const message = isRouteErrorResponse(error)
		? `${error.status} ${error.statusText}`
		: error instanceof Error
			? error.message
			: "An unexpected route error occurred.";

	return (
		<main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
			<Card className="w-full max-w-lg">
				<CardHeader>
					<CardTitle>Something went wrong</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="type-muted">{message}</p>
					<Button type="button" onClick={() => window.location.reload()}>
						Reload application
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}

export function RouteLoadingFallback() {
	return (
		<main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
			<p className="type-muted" role="status">
				Loading workspace...
			</p>
		</main>
	);
}
