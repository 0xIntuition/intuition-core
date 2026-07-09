import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Search } from 'lucide-react';
import { z } from 'zod';
import { AtomThumb } from '@/components/atom-thumb';
import { ClassificationBadge, OnchainBadge, PipelineCells } from '@/components/badges';
import { PageHeader } from '@/components/layout/app-shell';
import { DataTable, Pager } from '@/components/ui/data-table';
import { Card, ErrorNote, IdChip, Input } from '@/components/ui/primitives';
import { type AtomListItem, api } from '@/lib/api';
import { formatId, formatRelativeTime, previewData } from '@/lib/format';
import { extractImageFromRecord } from '@/lib/images';

const PAGE_SIZE = 25;

const searchSchema = z.object({
	q: z.string().optional(),
	type: z.string().optional(),
	offset: z.number().int().min(0).optional(),
});

export const Route = createFileRoute('/atoms/')({
	validateSearch: searchSchema,
	component: AtomsPage,
});

const columns: ColumnDef<AtomListItem>[] = [
	{
		id: 'thumb',
		header: '',
		cell: ({ row }) => (
			<AtomThumb
				id={row.original.id}
				imageUrl={extractImageFromRecord(row.original.dataResolved)}
			/>
		),
	},
	{
		id: 'data',
		header: 'Data',
		cell: ({ row }) => (
			<span className="block max-w-md truncate text-[13px]" title={row.original.data ?? ''}>
				{previewData(row.original.data, 80) || <span className="text-faint">(empty)</span>}
			</span>
		),
	},
	{
		id: 'id',
		header: 'Atom ID',
		cell: ({ row }) => <IdChip id={row.original.id} short={formatId(row.original.id)} />,
	},
	{
		id: 'classification',
		header: 'Classification',
		cell: ({ row }) => <ClassificationBadge type={row.original.classificationType} />,
	},
	{
		id: 'rawType',
		header: 'Raw',
		cell: ({ row }) => (
			<span className="font-mono text-[11px] text-muted">{row.original.rawType}</span>
		),
	},
	{
		id: 'pipeline',
		header: 'Pipeline',
		cell: ({ row }) => (
			<PipelineCells
				classification={row.original.classificationStatus}
				enrichment={row.original.enrichmentStatus}
				parse={row.original.parseStatus}
			/>
		),
	},
	{
		id: 'onchain',
		header: 'Source',
		cell: ({ row }) => <OnchainBadge isOnchain={row.original.isOnchain} />,
	},
	{
		id: 'created',
		header: 'Created',
		cell: ({ row }) => (
			<span className="text-[12px] text-faint tabular-nums">
				{formatRelativeTime(row.original.createdAt)}
			</span>
		),
	},
];

function AtomsPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const offset = search.offset ?? 0;

	const query = useQuery({
		queryKey: ['atoms', { q: search.q, type: search.type, offset }],
		queryFn: () =>
			api.atoms({
				limit: PAGE_SIZE,
				offset,
				q: search.q,
				classification_type: search.type,
			}),
	});

	const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
		navigate({ search: (prev) => ({ ...prev, offset: undefined, ...patch }), replace: true });

	return (
		<>
			<PageHeader
				description="Every atom in the local knowledge graph, with its processing pipeline state."
				title="Atoms"
			/>

			<div className="mb-3 flex items-center gap-2">
				<div className="relative">
					<Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-faint" />
					<Input
						className="w-72 pl-8"
						defaultValue={search.q ?? ''}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								setSearch({ q: event.currentTarget.value || undefined });
							}
						}}
						placeholder="Search atom data… (enter)"
					/>
				</div>
				<Input
					className="w-52"
					defaultValue={search.type ?? ''}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							setSearch({ type: event.currentTarget.value || undefined });
						}
					}}
					placeholder="Classification type… (enter)"
				/>
				{(search.q || search.type) && (
					<button
						className="text-[12px] text-faint hover:text-foreground"
						onClick={() => navigate({ search: {}, replace: true })}
						type="button"
					>
						clear filters
					</button>
				)}
			</div>

			{query.error ? <ErrorNote error={query.error} /> : null}

			<Card>
				<DataTable
					columns={columns}
					data={query.data?.data ?? []}
					emptyMessage="No atoms match — index a chain or create one in the playground."
					isLoading={query.isLoading}
					onRowClick={(atom) => navigate({ to: '/atoms/$atomId', params: { atomId: atom.id } })}
				/>
				<Pager
					count={query.data?.pagination?.count ?? 0}
					limit={PAGE_SIZE}
					offset={offset}
					onOffsetChange={(next) =>
						navigate({ search: (prev) => ({ ...prev, offset: next || undefined }), replace: true })
					}
				/>
			</Card>
		</>
	);
}
