import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { SkeletonRows } from './ui/primitives';

type ServiceStatus = {
	name: string;
	url: string;
	ok: boolean;
	status: number | null;
	latencyMs: number | null;
};

/**
 * Live service-health grid. Polls the explorer's own `/api/status` server
 * route (which probes the services from the server side — no CORS).
 */
export function HealthGrid() {
	const query = useQuery({
		queryKey: ['service-status'],
		queryFn: async (): Promise<{ data: ServiceStatus[]; checkedAt: string }> => {
			const response = await fetch('/api/status');
			if (!response.ok) {
				throw new Error(`status probe failed (${response.status})`);
			}
			return response.json();
		},
		refetchInterval: 10_000,
	});

	if (!query.data) {
		return (
			<SkeletonRows
				className="grid grid-cols-2 gap-2 p-4 lg:grid-cols-4"
				count={7}
				itemClassName="h-14"
			/>
		);
	}

	return (
		<div className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
			{query.data.data.map((service) => (
				<div
					className={cn(
						'rounded-md border px-3 py-2',
						service.ok ? 'border-border bg-surface-raised' : 'border-danger/40 bg-danger-muted'
					)}
					key={service.name}
					title={service.url}
				>
					<div className="flex items-center gap-1.5">
						<span
							className={cn(
								'inline-block size-2 rounded-full',
								service.ok ? 'bg-success' : 'bg-danger'
							)}
						/>
						<span className="truncate font-medium text-[12px]">{service.name}</span>
					</div>
					<div className="mt-0.5 text-[11px] text-faint tabular-nums">
						{service.ok
							? `${service.status} · ${service.latencyMs}ms`
							: service.status
								? `HTTP ${service.status}`
								: 'unreachable'}
					</div>
				</div>
			))}
		</div>
	);
}
