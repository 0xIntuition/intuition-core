import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageHeader } from '@/components/layout/app-shell';
import { JsonViewer } from '@/components/ui/json-viewer';
import { Card, EmptyState, ErrorNote, IdChip, SkeletonRows } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatId } from '@/lib/format';

export const Route = createFileRoute('/predicates')({
	component: PredicatesPage,
});

function PredicatesPage() {
	const query = useQuery({ queryKey: ['predicates'], queryFn: () => api.predicates() });

	return (
		<>
			<PageHeader
				description="The predicate registry — the verbs of the knowledge graph. Baseline predicates are seeded on first migrate."
				title="Predicates"
			/>

			{query.error ? <ErrorNote error={query.error} /> : null}

			<Card>
				{query.isLoading ? (
					<SkeletonRows className="space-y-2 p-3" count={8} itemClassName="h-9 w-full" />
				) : query.data && query.data.data.length > 0 ? (
					<ul className="divide-y divide-border/60">
						{query.data.data.map((predicate) => {
							const record = predicate as Record<string, unknown>;
							return (
								<li className="px-3 py-2.5" key={predicate.id}>
									<div className="flex items-center gap-3">
										<code className="rounded bg-accent-muted px-2 py-0.5 font-mono text-[12px] text-accent">
											{predicate.slug ?? formatId(predicate.id)}
										</code>
										{typeof record.label === 'string' ? (
											<span className="text-[13px]">{record.label}</span>
										) : null}
										<span className="flex-1" />
										<Link
											className="text-[11px] text-faint hover:text-accent"
											params={{ atomId: predicate.id }}
											to="/atoms/$atomId"
										>
											view atom
										</Link>
										<IdChip id={predicate.id} short={formatId(predicate.id)} />
									</div>
									{typeof record.description === 'string' ? (
										<p className="mt-1 text-[12px] text-muted">{record.description}</p>
									) : null}
								</li>
							);
						})}
					</ul>
				) : (
					<EmptyState>No predicates registered.</EmptyState>
				)}
			</Card>

			{query.data ? (
				<details className="mt-3">
					<summary className="cursor-pointer text-[12px] text-faint hover:text-foreground">
						raw response
					</summary>
					<div className="mt-2">
						<JsonViewer value={query.data.data} />
					</div>
				</details>
			) : null}
		</>
	);
}
