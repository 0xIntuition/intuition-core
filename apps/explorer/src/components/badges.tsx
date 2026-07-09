import { classificationClasses, statusClasses } from '@/lib/classification';
import { Badge } from './ui/primitives';

export function ClassificationBadge({ type }: { type: string }) {
	return <Badge className={classificationClasses(type)}>{type}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
	return <Badge className={statusClasses(status)}>{status}</Badge>;
}

/** The three pipeline stages as compact dots+labels for table rows. */
export function PipelineCells({
	parse,
	classification,
	enrichment,
}: {
	parse: string;
	classification: string;
	enrichment: string;
}) {
	return (
		<div className="flex items-center gap-1">
			{(
				[
					['P', parse],
					['C', classification],
					['E', enrichment],
				] as const
			).map(([label, status]) => (
				<span
					className={`inline-flex size-5 items-center justify-center rounded border font-mono text-[10px] ${statusClasses(status)}`}
					key={label}
					title={`${label === 'P' ? 'parse' : label === 'C' ? 'classification' : 'enrichment'}: ${status}`}
				>
					{label}
				</span>
			))}
		</div>
	);
}

export function OnchainBadge({ isOnchain }: { isOnchain: boolean }) {
	return isOnchain ? (
		<Badge className="border-accent/25 bg-accent-muted text-accent">onchain</Badge>
	) : (
		<Badge className="border-border bg-surface-raised text-faint">offchain</Badge>
	);
}
