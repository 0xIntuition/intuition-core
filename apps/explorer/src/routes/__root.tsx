import inter400 from '@fontsource/inter/400.css?url';
import inter500 from '@fontsource/inter/500.css?url';
import inter600 from '@fontsource/inter/600.css?url';
import jetbrains400 from '@fontsource/jetbrains-mono/400.css?url';
import jetbrains500 from '@fontsource/jetbrains-mono/500.css?url';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router';
import { AppShell } from '@/components/layout/app-shell';
import appCss from '@/styles.css?url';

interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1' },
			{ title: 'Intuition Core Explorer' },
			{
				name: 'description',
				content: 'Dashboard and data explorer for a self-hosted Intuition Core node.',
			},
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'stylesheet', href: inter400 },
			{ rel: 'stylesheet', href: inter500 },
			{ rel: 'stylesheet', href: inter600 },
			{ rel: 'stylesheet', href: jetbrains400 },
			{ rel: 'stylesheet', href: jetbrains500 },
		],
	}),
	component: RootDocument,
	errorComponent: RootErrorComponent,
});

function RootDocument() {
	const { queryClient } = Route.useRouteContext();
	return (
		<html className="dark" lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<QueryClientProvider client={queryClient}>
					<AppShell>
						<Outlet />
					</AppShell>
				</QueryClientProvider>
				<Scripts />
			</body>
		</html>
	);
}

function RootErrorComponent({ error }: ErrorComponentProps) {
	return (
		<html className="dark" lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				<div className="flex min-h-screen items-center justify-center p-8">
					<div className="max-w-lg rounded-lg border border-danger/40 bg-surface p-6">
						<h1 className="mb-2 font-semibold text-danger text-lg">Explorer crashed</h1>
						<pre className="overflow-x-auto whitespace-pre-wrap font-mono text-muted text-xs">
							{error instanceof Error ? error.message : String(error)}
						</pre>
					</div>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
