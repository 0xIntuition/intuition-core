import type { ReactNode } from 'react';
import { formatNumber } from '@/lib/format';
import { Card, Skeleton } from './ui/primitives';

export function StatCard({
	label,
	value,
	icon,
	isLoading,
}: {
	label: string;
	value: number | undefined;
	icon?: ReactNode;
	isLoading?: boolean;
}) {
	return (
		<Card className="px-4 py-3">
			<div className="flex items-center justify-between">
				<span className="text-[11px] text-faint uppercase tracking-wider">{label}</span>
				{icon}
			</div>
			{isLoading || value === undefined ? (
				<Skeleton className="mt-1.5 h-7 w-20" />
			) : (
				<div className="mt-0.5 font-semibold text-[26px] tabular-nums leading-snug">
					{formatNumber(value)}
				</div>
			)}
		</Card>
	);
}
