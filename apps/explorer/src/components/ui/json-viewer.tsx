import { CopyButton } from './primitives';

/** Pretty-printed JSON block with copy — used for results, payloads, errors. */
export function JsonViewer({ value, maxHeight = 420 }: { value: unknown; maxHeight?: number }) {
	if (value === null || value === undefined) {
		return <span className="text-[12px] text-faint">—</span>;
	}
	const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	return (
		<div className="relative rounded-md border border-border bg-background">
			<div className="absolute top-1 right-1">
				<CopyButton value={text} />
			</div>
			<pre
				className="overflow-auto px-3 py-2.5 font-mono text-[11.5px] text-muted leading-relaxed"
				style={{ maxHeight }}
			>
				{text}
			</pre>
		</div>
	);
}
