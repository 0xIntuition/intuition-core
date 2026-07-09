import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ArtifactCard } from '@/components/artifact-card';
import { AtomThumb } from '@/components/atom-thumb';
import { ClassificationBadge, OnchainBadge, StatusBadge } from '@/components/badges';
import { EventsList } from '@/components/events-list';
import { PageHeader } from '@/components/layout/app-shell';
import { TermChip } from '@/components/term-chip';
import { JsonViewer } from '@/components/ui/json-viewer';
import {
	Card,
	CardHeader,
	EmptyState,
	ErrorNote,
	IdChip,
	Skeleton,
} from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatId, formatRelativeTime, previewData } from '@/lib/format';
import { extractImageFromRecord } from '@/lib/images';

export const Route = createFileRoute('/atoms/$atomId')({
	component: AtomDetailPage,
});

function AtomDetailPage() {
	const { atomId } = Route.useParams();

	const atom = useQuery({ queryKey: ['atom', atomId], queryFn: () => api.atom(atomId) });
	const artifacts = useQuery({
		queryKey: ['atom-artifacts', atomId],
		queryFn: () => api.atomArtifacts(atomId, { limit: 50 }),
	});
	const triples = useQuery({
		queryKey: ['atom-triples', atomId],
		queryFn: () => api.atomTriples(atomId, { limit: 50 }),
	});
	const events = useQuery({
		queryKey: ['events', { entity_id: atomId }],
		queryFn: () => api.events({ entity_id: atomId, limit: 20 }),
	});

	if (atom.error) {
		return (
			<>
				<BackLink />
				<ErrorNote error={atom.error} />
			</>
		);
	}

	const data = atom.data?.data;

	return (
		<>
			<BackLink />
			{data ? (
				<PageHeader
					description={
						<span className="inline-flex flex-wrap items-center gap-2">
							<IdChip id={data.id} short={formatId(data.id, 18, 8)} />
							<span className="text-faint">·</span>
							<span>created {formatRelativeTime(data.createdAt)} ago</span>
							{data.createdBy ? (
								<>
									<span className="text-faint">·</span>
									<span className="font-mono text-[11px]">by {formatId(data.createdBy)}</span>
								</>
							) : null}
						</span>
					}
					title={
						<span className="inline-flex items-center gap-3">
							<AtomThumb
								id={data.id}
								imageUrl={
									extractImageFromRecord(data.dataResolved) ??
									extractImageFromRecord(
										artifacts.data?.data.map((a) => a.extracted).find(extractImageFromRecord)
									)
								}
								size={36}
							/>
							<span className="max-w-2xl truncate">
								{previewData(data.data, 80) || formatId(data.id)}
							</span>
							<ClassificationBadge type={data.classificationType} />
							<OnchainBadge isOnchain={data.isOnchain} />
						</span>
					}
				/>
			) : (
				<Skeleton className="mb-5 h-16 w-full" />
			)}

			<div className="grid gap-3 lg:grid-cols-3">
				{/* ── Left: raw data + pipeline results ── */}
				<div className="space-y-3 lg:col-span-2">
					<Card>
						<CardHeader hint={data?.rawType} title="Raw data" />
						<div className="p-3">
							<JsonViewer maxHeight={220} value={data?.data ?? null} />
						</div>
					</Card>

					{data?.dataResolved != null && Object.keys(data.dataResolved as object).length > 0 ? (
						<Card>
							<CardHeader hint="merged view served to consumers" title="Resolved data" />
							<div className="p-3">
								<JsonViewer value={data.dataResolved} />
							</div>
						</Card>
					) : null}

					<Card>
						<CardHeader
							hint={`${artifacts.data?.data.length ?? '…'} attached`}
							title="Enrichment artifacts"
						/>
						{artifacts.isLoading ? (
							<div className="space-y-2 p-3">
								<Skeleton className="h-24 w-full" />
								<Skeleton className="h-24 w-full" />
							</div>
						) : artifacts.data && artifacts.data.data.length > 0 ? (
							<div className="space-y-2.5 p-3">
								{artifacts.data.data.map((artifact) => (
									<ArtifactCard artifact={artifact} key={artifact.id} />
								))}
							</div>
						) : (
							<EmptyState>
								No artifacts — enrichment {data ? `is ${data.enrichmentStatus}` : 'pending'} for
								this atom.
							</EmptyState>
						)}
					</Card>

					<Card>
						<CardHeader
							hint="this atom highlighted in position"
							title={`Triples (${triples.data?.data.length ?? '…'})`}
						/>
						{triples.isLoading ? (
							<div className="space-y-2 p-3">
								<Skeleton className="h-10 w-full" />
								<Skeleton className="h-10 w-full" />
							</div>
						) : triples.data && triples.data.data.length > 0 ? (
							<ul className="divide-y divide-border/60">
								{triples.data.data.map((triple) => (
									<li className="flex flex-wrap items-center gap-1.5 px-3 py-2" key={triple.id}>
										<TermChip
											highlight={triple.subjectId === atomId}
											term={triple.subject}
											termId={triple.subjectId}
										/>
										<span className="text-faint">→</span>
										<TermChip
											highlight={triple.predicateId === atomId}
											term={triple.predicate}
											termId={triple.predicateId}
										/>
										<span className="text-faint">→</span>
										<TermChip
											highlight={triple.objectId === atomId}
											term={triple.object}
											termId={triple.objectId}
										/>
										<span className="flex-1" />
										<Link
											className="text-[11px] text-faint hover:text-accent"
											params={{ tripleId: triple.id }}
											to="/triples/$tripleId"
										>
											{formatId(triple.id)}
										</Link>
									</li>
								))}
							</ul>
						) : (
							<EmptyState>This atom is not part of any triple yet.</EmptyState>
						)}
					</Card>
				</div>

				{/* ── Right: pipeline state, graph stats, activity ── */}
				<div className="space-y-3">
					<Card>
						<CardHeader title="Pipeline" />
						<dl className="space-y-2 px-4 py-3">
							{data
								? (
										[
											['parse', data.parseStatus, data.parseResult, data.parseError],
											[
												'classification',
												data.classificationStatus,
												data.classificationResult,
												data.classificationError,
											],
											['enrichment', data.enrichmentStatus, null, data.enrichmentError],
										] as const
									).map(([stage, status, result, error]) => (
										<div key={stage}>
											<div className="flex items-center justify-between">
												<dt className="text-[12px] capitalize">{stage}</dt>
												<dd>
													<StatusBadge status={status} />
												</dd>
											</div>
											{result != null ? (
												<div className="mt-1.5">
													<JsonViewer maxHeight={180} value={result} />
												</div>
											) : null}
											{error != null ? (
												<div className="mt-1.5">
													<JsonViewer maxHeight={120} value={error} />
												</div>
											) : null}
										</div>
									))
								: null}
						</dl>
					</Card>

					<Card>
						<CardHeader hint="from adjacency projections" title="Graph" />
						{data?.stats ? (
							<div className="px-4 py-3">
								<div className="flex gap-6">
									<div>
										<div className="text-[11px] text-faint uppercase tracking-wider">In</div>
										<div className="font-semibold text-[22px] tabular-nums">
											{data.stats.inDegree}
										</div>
									</div>
									<div>
										<div className="text-[11px] text-faint uppercase tracking-wider">Out</div>
										<div className="font-semibold text-[22px] tabular-nums">
											{data.stats.outDegree}
										</div>
									</div>
								</div>
								{data.stats.predicateCounts &&
								Object.keys(data.stats.predicateCounts as object).length > 0 ? (
									<div className="mt-2">
										<JsonViewer maxHeight={160} value={data.stats.predicateCounts} />
									</div>
								) : null}
							</div>
						) : (
							<EmptyState>No graph stats yet.</EmptyState>
						)}
					</Card>

					<Card>
						<CardHeader title="Activity" />
						<EventsList events={events.data?.data} isLoading={events.isLoading} />
					</Card>
				</div>
			</div>
		</>
	);
}

function BackLink() {
	return (
		<Link
			className="mb-3 inline-flex items-center gap-1 text-[12px] text-faint hover:text-foreground"
			to="/atoms"
		>
			<ArrowLeft className="size-3.5" /> all atoms
		</Link>
	);
}
