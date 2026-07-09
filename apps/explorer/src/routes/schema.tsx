import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Card, CardHeader, ErrorNote, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';

export const Route = createFileRoute('/schema')({
	component: SchemaPage,
});

type SchemaColumn = {
	name?: string;
	type?: string;
	nullable?: boolean;
	default?: string | null;
};
type SchemaTable = { name?: string; columns?: SchemaColumn[] };

function asTables(payload: unknown): SchemaTable[] {
	if (typeof payload !== 'object' || payload === null) {
		return [];
	}
	const tables = (payload as { tables?: unknown }).tables;
	return Array.isArray(tables) ? (tables as SchemaTable[]) : [];
}

function SchemaPage() {
	const query = useQuery({ queryKey: ['schema'], queryFn: () => api.schema() });
	const tables = asTables(query.data?.data);

	return (
		<>
			<PageHeader
				description="Live data-model metadata from GET /api/schema — what a consumer can rely on."
				title="Schema"
			/>

			{query.error ? <ErrorNote error={query.error} /> : null}
			{query.isLoading ? <Skeleton className="h-64 w-full" /> : null}

			{tables.length > 0 ? (
				<div className="grid gap-3 lg:grid-cols-2">
					{tables.map((table) => (
						<Card key={table.name}>
							<CardHeader hint={`${table.columns?.length ?? 0} columns`} title={table.name} />
							<table className="w-full text-[12px]">
								<tbody>
									{(table.columns ?? []).map((column) => (
										<tr className="border-border/60 border-b last:border-0" key={column.name}>
											<td className="px-3 py-1.5 font-mono">{column.name}</td>
											<td className="px-3 py-1.5 text-muted">{column.type}</td>
											<td className="px-3 py-1.5 text-right text-faint">
												{column.nullable ? 'nullable' : ''}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</Card>
					))}
				</div>
			) : query.data ? (
				<Card>
					<div className="p-3">
						<JsonViewer value={query.data.data} />
					</div>
				</Card>
			) : null}
		</>
	);
}
