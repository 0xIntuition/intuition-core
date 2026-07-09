import { Link } from '@tanstack/react-router';
import {
	Activity,
	Boxes,
	Database,
	LayoutDashboard,
	Link2,
	Tags,
	TerminalSquare,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { API_URL } from '@/lib/api';

const NAV = [
	{ to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
	{ to: '/atoms', label: 'Atoms', icon: Boxes },
	{ to: '/triples', label: 'Triples', icon: Link2 },
	{ to: '/predicates', label: 'Predicates', icon: Tags },
	{ to: '/events', label: 'Events', icon: Activity },
	{ to: '/schema', label: 'Schema', icon: Database },
	{ to: '/playground', label: 'Playground', icon: TerminalSquare },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen">
			<aside className="fixed inset-y-0 flex w-52 flex-col border-border border-r bg-surface">
				<Link className="flex items-center gap-2.5 px-4 py-4" to="/">
					<div className="flex size-7 items-center justify-center rounded-md bg-accent font-bold text-sm text-white">
						∴
					</div>
					<div className="leading-tight">
						<div className="font-semibold text-[13px]">Intuition Core</div>
						<div className="text-[11px] text-faint">Explorer</div>
					</div>
				</Link>

				<nav className="flex flex-1 flex-col gap-0.5 px-2 py-2">
					{NAV.map(({ to, label, icon: Icon, ...opts }) => (
						<Link
							activeOptions={{ exact: 'exact' in opts && opts.exact }}
							activeProps={{
								className: 'bg-accent-muted text-foreground',
							}}
							className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
							key={to}
							to={to}
						>
							<Icon className="size-4" strokeWidth={1.8} />
							{label}
						</Link>
					))}
				</nav>

				<div className="border-border border-t px-4 py-3">
					<div className="text-[10px] text-faint uppercase tracking-wider">API</div>
					<div className="truncate font-mono text-[11px] text-muted" title={API_URL}>
						{API_URL}
					</div>
					<a
						className="mt-1 inline-block text-[11px] text-faint hover:text-accent"
						href="https://github.com/0xIntuition/intuition-core"
						rel="noreferrer"
						target="_blank"
					>
						0xIntuition/intuition-core
					</a>
				</div>
			</aside>

			<main className="ml-52 min-w-0 flex-1 px-6 py-5">{children}</main>
		</div>
	);
}

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="mb-5 flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="font-semibold text-[17px] leading-tight">{title}</h1>
				{description ? <p className="mt-1 text-[13px] text-muted">{description}</p> : null}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
		</div>
	);
}
