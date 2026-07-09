import { Link } from '@tanstack/react-router';
import type { KgEvent } from '@/lib/api';
import { formatId, formatRelativeTime } from '@/lib/format';
import { OnchainBadge } from './badges';
import { Badge, EmptyState, IdChip, SkeletonRows } from './ui/primitives';

const ENTITY_KIND_CLASSES: Record<string, string> = {
	node: 'border-accent/25 bg-accent-muted text-accent',
	triple: 'border-info/25 bg-info-muted text-info',
	predicate: 'border-warning/25 bg-warning-muted text-warning',
	artifact: 'border-success/25 bg-success-muted text-success',
};

function entityLink(event: KgEvent) {
	if (event.entityKind === 'node') {
		return (
			<Link
				className="font-mono text-[11px] text-muted hover:text-accent"
				params={{ atomId: event.entityId }}
				to="/atoms/$atomId"
			>
				{formatId(event.entityId)}
			</Link>
		);
	}
	if (event.entityKind === 'triple') {
		return (
			<Link
				className="font-mono text-[11px] text-muted hover:text-accent"
				params={{ tripleId: event.entityId }}
				to="/triples/$tripleId"
			>
				{formatId(event.entityId)}
			</Link>
		);
	}
	return <IdChip id={event.entityId} short={formatId(event.entityId)} />;
}

/** Compact activity rows — shared by the dashboard, /events, and detail pages. */
export function EventsList({
	events,
	isLoading,
}: {
	events: KgEvent[] | undefined;
	isLoading?: boolean;
}) {
	if (isLoading || !events) {
		return <SkeletonRows count={6} itemClassName="h-7 w-full" />;
	}
	if (events.length === 0) {
		return <EmptyState>No events yet — create an atom and watch this feed.</EmptyState>;
	}

	return (
		<ul className="divide-y divide-border/60">
			{events.map((event) => (
				<li className="flex items-center gap-2.5 px-3 py-2" key={`${event.eventTime}-${event.id}`}>
					<Badge className={ENTITY_KIND_CLASSES[event.entityKind] ?? 'border-border text-muted'}>
						{event.entityKind}
					</Badge>
					<span className="text-[12px] text-muted">{event.eventType}</span>
					{entityLink(event)}
					<span className="flex-1" />
					<OnchainBadge isOnchain={event.isOnchain} />
					{event.blockNumber !== null ? (
						<span className="text-[11px] text-faint tabular-nums">#{event.blockNumber}</span>
					) : null}
					<span className="w-10 text-right text-[11px] text-faint tabular-nums">
						{formatRelativeTime(event.eventTime)}
					</span>
				</li>
			))}
		</ul>
	);
}
