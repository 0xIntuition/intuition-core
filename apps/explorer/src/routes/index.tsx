import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Boxes, Link2, Tags, Users } from 'lucide-react';
import { AtomThumb } from '@/components/atom-thumb';
import { ClassificationBadge, PipelineCells } from '@/components/badges';
import { EventsList } from '@/components/events-list';
import { HealthGrid } from '@/components/health-grid';
import { PageHeader } from '@/components/layout/app-shell';
import { PipelineBars } from '@/components/pipeline-bars';
import { StatCard } from '@/components/stat-card';
import { Card, CardHeader, EmptyState, SkeletonRows } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatRelativeTime, previewData } from '@/lib/format';
import { extractImageFromRecord } from '@/lib/images';

export const Route = createFileRoute('/')({
	component: DashboardPage,
});

function DashboardPage() {
	const stats = useQuery({
		queryKey: ['stats'],
		queryFn: () => api.stats(),
		refetchInterval: 15_000,
	});
	const pipeline = useQuery({
		queryKey: ['pipeline-stats'],
		queryFn: () => api.pipelineStats(),
		refetchInterval: 15_000,
	});
	const recentAtoms = useQuery({
		queryKey: ['atoms', { limit: 6 }],
		queryFn: () => api.atoms({ limit: 6 }),
		refetchInterval: 15_000,
	});
	const recentEvents = useQuery({
		queryKey: ['events', { limit: 8 }],
		queryFn: () => api.events({ limit: 8 }),
		refetchInterval: 15_000,
	});

	return (
		<>
			<PageHeader
				description="Your node at a glance — data volumes, worker pipeline, and service health."
				title="Dashboard"
			/>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatCard
					icon={<Boxes className="size-4 text-faint" />}
					isLoading={stats.isLoading}
					label="Atoms"
					value={stats.data?.data.atoms}
				/>
				<StatCard
					icon={<Link2 className="size-4 text-faint" />}
					isLoading={stats.isLoading}
					label="Triples"
					value={stats.data?.data.triples}
				/>
				<StatCard
					icon={<Tags className="size-4 text-faint" />}
					isLoading={stats.isLoading}
					label="Predicates"
					value={stats.data?.data.predicates}
				/>
				<StatCard
					icon={<Users className="size-4 text-faint" />}
					isLoading={stats.isLoading}
					label="Accounts"
					value={stats.data?.data.accounts}
				/>
			</div>

			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card>
					<CardHeader hint="live · 10s" title="Service health" />
					<HealthGrid />
				</Card>
				<Card>
					<CardHeader hint="parse → classify → enrich" title="Worker pipeline" />
					<PipelineBars stats={pipeline.data?.data} />
				</Card>
			</div>

			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card>
					<CardHeader
						actions={
							<Link className="text-[12px] text-accent hover:underline" to="/atoms">
								view all →
							</Link>
						}
						title="Latest atoms"
					/>
					{recentAtoms.isLoading ? (
						<SkeletonRows count={6} itemClassName="h-9 w-full" />
					) : recentAtoms.data && recentAtoms.data.data.length > 0 ? (
						<ul className="divide-y divide-border/60">
							{recentAtoms.data.data.map((atom) => (
								<li key={atom.id}>
									<Link
										className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-hover"
										params={{ atomId: atom.id }}
										to="/atoms/$atomId"
									>
										<AtomThumb id={atom.id} imageUrl={extractImageFromRecord(atom.dataResolved)} />
										<span className="min-w-0 flex-1 truncate text-[13px]">
											{previewData(atom.data, 64) || atom.id}
										</span>
										<ClassificationBadge type={atom.classificationType} />
										<PipelineCells
											classification={atom.classificationStatus}
											enrichment={atom.enrichmentStatus}
											parse={atom.parseStatus}
										/>
										<span className="w-8 text-right text-[11px] text-faint tabular-nums">
											{formatRelativeTime(atom.createdAt)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					) : (
						<EmptyState>No atoms yet — index a chain or use the playground.</EmptyState>
					)}
				</Card>

				<Card>
					<CardHeader
						actions={
							<Link className="text-[12px] text-accent hover:underline" to="/events">
								view all →
							</Link>
						}
						title={
							<span className="inline-flex items-center gap-1.5">
								<Activity className="size-3.5 text-faint" /> Activity
							</span>
						}
					/>
					<EventsList events={recentEvents.data?.data} isLoading={recentEvents.isLoading} />
				</Card>
			</div>
		</>
	);
}
