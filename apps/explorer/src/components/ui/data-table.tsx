import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, EmptyState, SkeletonRows } from './primitives';

/**
 * Dense read-only table over server-paginated data. Sorting/filtering happen
 * on the server via query params, so this only renders rows.
 */
export function DataTable<T>({
	columns,
	data,
	isLoading,
	onRowClick,
	emptyMessage = 'Nothing here yet.',
}: {
	columns: ColumnDef<T, unknown>[];
	data: T[];
	isLoading?: boolean;
	onRowClick?: (row: T) => void;
	emptyMessage?: string;
}) {
	const table = useReactTable({ columns, data, getCoreRowModel: getCoreRowModel() });

	if (isLoading) {
		return <SkeletonRows count={8} />;
	}

	if (data.length === 0) {
		return <EmptyState>{emptyMessage}</EmptyState>;
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full border-collapse text-[13px]">
				<thead>
					{table.getHeaderGroups().map((headerGroup) => (
						<tr className="border-border border-b" key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<th
									className="whitespace-nowrap px-3 py-2 text-left font-medium text-[11px] text-faint uppercase tracking-wider"
									key={header.id}
								>
									{header.isPlaceholder
										? null
										: flexRender(header.column.columnDef.header, header.getContext())}
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => (
						<tr
							className={cn(
								'border-border/60 border-b last:border-0',
								onRowClick && 'cursor-pointer transition-colors hover:bg-surface-hover'
							)}
							key={row.id}
							onClick={onRowClick ? () => onRowClick(row.original) : undefined}
						>
							{row.getVisibleCells().map((cell) => (
								<td className="px-3 py-2 align-middle" key={cell.id}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Offset pager driven by the API's `{limit, offset, count}` pagination. */
export function Pager({
	limit,
	offset,
	count,
	onOffsetChange,
}: {
	limit: number;
	offset: number;
	count: number;
	onOffsetChange: (offset: number) => void;
}) {
	const page = Math.floor(offset / limit) + 1;
	const hasNext = count === limit;
	return (
		<div className="flex items-center justify-between border-border border-t px-3 py-2">
			<span className="text-[12px] text-faint">
				page {page} · showing {count}
			</span>
			<div className="flex gap-1.5">
				<Button disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - limit))}>
					<ChevronLeft className="size-3.5" /> Prev
				</Button>
				<Button disabled={!hasNext} onClick={() => onOffsetChange(offset + limit)}>
					Next <ChevronRight className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
