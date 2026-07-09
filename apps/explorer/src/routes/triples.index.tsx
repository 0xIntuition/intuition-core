import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { OnchainBadge } from '@/components/badges';
import { PageHeader } from '@/components/layout/app-shell';
import { TermChip } from '@/components/term-chip';
import { Pager } from '@/components/ui/data-table';
import { Card, EmptyState, ErrorNote, SkeletonRows } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatId, formatRelativeTime } from '@/lib/format';

const PAGE_SIZE = 25;

export const Route = createFileRoute('/triples/')({
	validateSearch: z.object({
		offset: z.number().int().min(0).optional(),
	}),
	component: TriplesPage,
});

function TriplesPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const offset = search.offset ?? 0;

	const query = useQuery({
		queryKey: ['triples', { offset }],
		queryFn: () => api.triples({ limit: PAGE_SIZE, offset }),
	});

	return (
		<>
			<PageHeader
				description="Claims in the graph — subject → predicate → object, with resolved terms."
				title="Triples"
			/>

			{query.error ? <ErrorNote error={query.error} /> : null}

			<Card>
				{query.isLoading ? (
					<SkeletonRows className="space-y-2 p-3" count={8} itemClassName="h-10 w-full" />
				) : query.data && query.data.data.length > 0 ? (
					<ul className="divide-y divide-border/60">
						{query.data.data.map((triple) => (
							<li className="flex flex-wrap items-center gap-1.5 px-3 py-2.5" key={triple.id}>
								<TermChip term={triple.subject} termId={triple.subjectId} />
								<span className="text-faint">→</span>
								<TermChip term={triple.predicate} termId={triple.predicateId} />
								<span className="text-faint">→</span>
								<TermChip term={triple.object} termId={triple.objectId} />
								<span className="flex-1" />
								{triple.isOnchain !== undefined ? (
									<OnchainBadge isOnchain={triple.isOnchain} />
								) : null}
								<Link
									className="font-mono text-[11px] text-faint hover:text-accent"
									params={{ tripleId: triple.id }}
									to="/triples/$tripleId"
								>
									{formatId(triple.id)}
								</Link>
								<span className="w-10 text-right text-[11px] text-faint tabular-nums">
									{formatRelativeTime(triple.createdAt)}
								</span>
							</li>
						))}
					</ul>
				) : (
					<EmptyState>No triples yet — create one in the playground.</EmptyState>
				)}
				<Pager
					count={query.data?.pagination?.count ?? 0}
					limit={PAGE_SIZE}
					offset={offset}
					onOffsetChange={(next) =>
						navigate({ search: { offset: next || undefined }, replace: true })
					}
				/>
			</Card>
		</>
	);
}
