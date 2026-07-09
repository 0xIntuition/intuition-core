import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { EventsList } from '@/components/events-list';
import { PageHeader } from '@/components/layout/app-shell';
import { Pager } from '@/components/ui/data-table';
import { Card, ErrorNote, Select } from '@/components/ui/primitives';
import { api } from '@/lib/api';

const PAGE_SIZE = 50;
const ENTITY_KINDS = ['node', 'triple', 'predicate', 'artifact'] as const;

export const Route = createFileRoute('/events')({
	validateSearch: z.object({
		kind: z.enum(ENTITY_KINDS).optional(),
		offset: z.number().int().min(0).optional(),
	}),
	component: EventsPage,
});

function EventsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const offset = search.offset ?? 0;

	const query = useQuery({
		queryKey: ['events', { kind: search.kind, offset }],
		queryFn: () => api.events({ entity_kind: search.kind, limit: PAGE_SIZE, offset }),
		refetchInterval: offset === 0 ? 10_000 : false,
	});

	return (
		<>
			<PageHeader
				description="The append-only activity log — everything that happens to the graph, onchain and off."
				title="Events"
			/>

			<div className="mb-3">
				<Select
					onChange={(event) =>
						navigate({
							search: {
								kind: (event.target.value || undefined) as (typeof ENTITY_KINDS)[number],
								offset: undefined,
							},
							replace: true,
						})
					}
					value={search.kind ?? ''}
				>
					<option value="">all kinds</option>
					{ENTITY_KINDS.map((kind) => (
						<option key={kind} value={kind}>
							{kind}
						</option>
					))}
				</Select>
			</div>

			{query.error ? <ErrorNote error={query.error} /> : null}

			<Card>
				<EventsList events={query.data?.data} isLoading={query.isLoading} />
				<Pager
					count={query.data?.pagination?.count ?? 0}
					limit={PAGE_SIZE}
					offset={offset}
					onOffsetChange={(next) =>
						navigate({
							search: (prev) => ({ ...prev, offset: next || undefined }),
							replace: true,
						})
					}
				/>
			</Card>
		</>
	);
}
