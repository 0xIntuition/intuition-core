import { Link } from '@tanstack/react-router';
import type { TermSummary } from '@/lib/api';
import { classificationClasses } from '@/lib/classification';
import { cn } from '@/lib/cn';
import { formatId, previewData } from '@/lib/format';

/**
 * One term of a triple as a linked chip: `[classification] data-preview`.
 * Unresolvable terms (not public / not yet indexed) render as their bare id.
 */
export function TermChip({
	termId,
	term,
	highlight,
}: {
	termId: string;
	term?: TermSummary;
	highlight?: boolean;
}) {
	const label = term?.data ? previewData(term.data, 42) : formatId(termId);
	return (
		<Link
			className={cn(
				'inline-flex max-w-72 items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors',
				highlight
					? 'border-accent/50 bg-accent-muted'
					: 'border-border bg-surface-raised hover:border-border-strong',
				!term && 'font-mono text-muted'
			)}
			params={{ atomId: termId }}
			title={term?.data ?? termId}
			to="/atoms/$atomId"
		>
			{term ? (
				<span
					className={cn(
						'rounded-sm border px-1 py-px text-[9px] uppercase tracking-wide',
						classificationClasses(term.classificationType)
					)}
				>
					{term.classificationType.slice(0, 12)}
				</span>
			) : null}
			<span className="truncate">{label}</span>
		</Link>
	);
}
