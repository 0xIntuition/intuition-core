import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { OnchainBadge } from '@/components/badges';
import { EventsList } from '@/components/events-list';
import { PageHeader } from '@/components/layout/app-shell';
import { TermChip } from '@/components/term-chip';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Card, CardHeader, ErrorNote, IdChip, Skeleton } from '@/components/ui/primitives';
import { api, type TermSummary } from '@/lib/api';
import { formatId, formatRelativeTime, previewData } from '@/lib/format';

export const Route = createFileRoute('/triples/$tripleId')({
	component: TripleDetailPage,
});

const POSITIONS = ['subject', 'predicate', 'object'] as const;

function TripleDetailPage() {
	const { tripleId } = Route.useParams();
	const triple = useQuery({ queryKey: ['triple', tripleId], queryFn: () => api.triple(tripleId) });
	const events = useQuery({
		queryKey: ['events', { entity_id: tripleId }],
		queryFn: () => api.events({ entity_id: tripleId, limit: 20 }),
	});

	if (triple.error) {
		return (
			<>
				<BackLink />
				<ErrorNote error={triple.error} />
			</>
		);
	}

	const data = triple.data?.data;
	const terms: Record<(typeof POSITIONS)[number], { id: string; term: TermSummary | undefined }> = {
		subject: { id: data?.subjectId ?? '', term: data?.subject },
		predicate: { id: data?.predicateId ?? '', term: data?.predicate },
		object: { id: data?.objectId ?? '', term: data?.object },
	};

	return (
		<>
			<BackLink />
			{data ? (
				<PageHeader
					description={
						<span className="inline-flex items-center gap-2">
							<IdChip id={data.id} short={formatId(data.id, 18, 8)} />
							<span className="text-faint">·</span>
							<span>created {formatRelativeTime(data.createdAt)} ago</span>
							{data.isOnchain !== undefined ? <OnchainBadge isOnchain={data.isOnchain} /> : null}
						</span>
					}
					title="Triple"
				/>
			) : (
				<Skeleton className="mb-5 h-14 w-full" />
			)}

			{data ? (
				<Card className="mb-3">
					<div className="flex flex-wrap items-center justify-center gap-2 px-4 py-5">
						<TermChip term={data.subject} termId={data.subjectId} />
						<span className="text-faint">→</span>
						<TermChip term={data.predicate} termId={data.predicateId} />
						<span className="text-faint">→</span>
						<TermChip term={data.object} termId={data.objectId} />
					</div>
				</Card>
			) : null}

			<div className="grid gap-3 lg:grid-cols-3">
				{POSITIONS.map((position) => {
					const { id, term } = terms[position];
					return (
						<Card key={position}>
							<CardHeader hint={term?.classificationType} title={position} />
							<div className="space-y-2 px-4 py-3">
								{term ? (
									<>
										<Link
											className="block truncate text-[13px] hover:text-accent"
											params={{ atomId: id }}
											title={term.data ?? id}
											to="/atoms/$atomId"
										>
											{previewData(term.data, 96) || formatId(id)}
										</Link>
										<div className="text-[11px] text-faint">
											raw type <code className="font-mono">{term.rawType}</code>
										</div>
									</>
								) : (
									<div className="text-[12px] text-faint">
										Term not resolvable (not public or not yet indexed).
									</div>
								)}
								<IdChip id={id} short={formatId(id, 14, 6)} />
							</div>
						</Card>
					);
				})}
			</div>

			<div className="mt-3 grid gap-3 lg:grid-cols-2">
				<Card>
					<CardHeader title="Full record" />
					<div className="p-3">
						{data ? <JsonViewer value={data} /> : <Skeleton className="h-40 w-full" />}
					</div>
				</Card>
				<Card>
					<CardHeader title="Activity" />
					<EventsList events={events.data?.data} isLoading={events.isLoading} />
				</Card>
			</div>
		</>
	);
}

function BackLink() {
	return (
		<Link
			className="mb-3 inline-flex items-center gap-1 text-[12px] text-faint hover:text-foreground"
			to="/triples"
		>
			<ArrowLeft className="size-3.5" /> all triples
		</Link>
	);
}
