import { Check, Copy } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div className={cn('rounded-lg border border-border bg-surface', className)}>{children}</div>
	);
}

export function CardHeader({
	title,
	hint,
	actions,
}: {
	title: ReactNode;
	hint?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between border-border border-b px-4 py-2.5">
			<div className="flex items-baseline gap-2">
				<h2 className="font-medium text-[13px]">{title}</h2>
				{hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
			</div>
			{actions}
		</div>
	);
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<span
			className={cn(
				'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 font-medium text-[11px]',
				className
			)}
		>
			{children}
		</span>
	);
}

export function Skeleton({ className }: { className?: string }) {
	return <div className={cn('animate-pulse rounded bg-surface-raised', className)} />;
}

const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** N loading placeholders without index-keyed JSX at every call site. */
export function SkeletonRows({
	count = 6,
	itemClassName = 'h-8 w-full',
	className = 'space-y-1.5 p-3',
}: {
	count?: number;
	itemClassName?: string;
	className?: string;
}) {
	return (
		<div className={className}>
			{SKELETON_KEYS.slice(0, Math.min(count, SKELETON_KEYS.length)).map((key) => (
				<Skeleton className={itemClassName} key={key} />
			))}
		</div>
	);
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			className={cn(
				'h-8 rounded-md border border-border bg-surface-raised px-2.5 text-[13px] placeholder:text-faint',
				'focus:border-accent/60 focus:outline-none',
				className
			)}
			{...props}
		/>
	);
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select
			className={cn(
				'h-8 rounded-md border border-border bg-surface-raised px-2 text-[13px]',
				'focus:border-accent/60 focus:outline-none',
				className
			)}
			{...props}
		/>
	);
}

export function Button({
	className,
	variant = 'default',
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' }) {
	return (
		<button
			className={cn(
				'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 font-medium text-[13px] transition-colors',
				'disabled:cursor-not-allowed disabled:opacity-50',
				variant === 'primary'
					? 'border-accent/50 bg-accent/90 text-white hover:bg-accent'
					: 'border-border bg-surface-raised text-foreground hover:bg-surface-hover',
				className
			)}
			type="button"
			{...props}
		/>
	);
}

export function CopyButton({ value, className }: { value: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			className={cn('rounded p-1 text-faint transition-colors hover:text-foreground', className)}
			onClick={() => {
				navigator.clipboard.writeText(value).then(() => {
					setCopied(true);
					setTimeout(() => setCopied(false), 1200);
				});
			}}
			title="Copy"
			type="button"
		>
			{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
		</button>
	);
}

/** Monospace id with copy affordance — the atom of this whole UI. */
export function IdChip({ id, short }: { id: string; short?: string }) {
	return (
		<span className="inline-flex items-center gap-0.5">
			<code className="font-mono text-[11px] text-muted" title={id}>
				{short ?? id}
			</code>
			<CopyButton value={id} />
		</span>
	);
}

export function EmptyState({ children }: { children: ReactNode }) {
	return <div className="px-4 py-10 text-center text-[13px] text-faint">{children}</div>;
}

export function ErrorNote({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<div className="rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-[12px] text-danger">
			{message}
		</div>
	);
}
