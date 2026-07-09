import type { PipelineStats } from '@/lib/api';
import { Skeleton } from './ui/primitives';

const STATUS_ORDER = ['completed', 'processing', 'pending', 'failed', 'skipped'] as const;
const STATUS_BAR_COLORS: Record<string, string> = {
	completed: 'var(--color-success)',
	processing: 'var(--color-info)',
	pending: 'var(--color-faint)',
	failed: 'var(--color-danger)',
	skipped: 'var(--color-border-strong)',
};

/**
 * One segmented bar per pipeline stage — the worker fleet's health at a
 * glance: mostly green when workers keep up, grey when backlogged, red when
 * something is failing.
 */
export function PipelineBars({ stats }: { stats: PipelineStats | undefined }) {
	if (!stats) {
		return (
			<div className="space-y-3 p-4">
				{['parse', 'classify', 'enrich'].map((stage) => (
					<Skeleton className="h-6 w-full" key={stage} />
				))}
			</div>
		);
	}

	return (
		<div className="space-y-3.5 px-4 py-3.5">
			{(Object.entries(stats) as Array<[string, Record<string, number>]>).map(([stage, counts]) => {
				const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
				return (
					<div key={stage}>
						<div className="mb-1 flex items-baseline justify-between">
							<span className="text-[12px] capitalize">{stage}</span>
							<span className="text-[11px] text-faint tabular-nums">{total} atoms</span>
						</div>
						<div className="flex h-2 overflow-hidden rounded-full bg-surface-raised">
							{STATUS_ORDER.filter((status) => counts[status]).map((status) => (
								<div
									key={status}
									style={{
										width: `${((counts[status] ?? 0) / Math.max(total, 1)) * 100}%`,
										background: STATUS_BAR_COLORS[status],
									}}
									title={`${status}: ${counts[status]}`}
								/>
							))}
						</div>
						<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
							{STATUS_ORDER.filter((status) => counts[status]).map((status) => (
								<span
									className="inline-flex items-center gap-1 text-[10.5px] text-faint"
									key={status}
								>
									<span
										className="inline-block size-1.5 rounded-full"
										style={{ background: STATUS_BAR_COLORS[status] }}
									/>
									{status} {counts[status]}
								</span>
							))}
						</div>
					</div>
				);
			})}
		</div>
	);
}
