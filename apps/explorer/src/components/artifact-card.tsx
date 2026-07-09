import { useState } from 'react';
import type { Artifact } from '@/lib/api';
import { extractImageFromRecord } from '@/lib/images';
import { StatusBadge } from './badges';
import { JsonViewer } from './ui/json-viewer';
import { Badge, Button } from './ui/primitives';

/**
 * One enrichment artifact: provider kind + status header, any image the
 * provider extracted, and the raw/extracted payloads on demand.
 */
export function ArtifactCard({ artifact }: { artifact: Artifact }) {
	const [tab, setTab] = useState<'extracted' | 'data' | null>('extracted');
	const image = extractImageFromRecord(artifact.extracted) ?? extractImageFromRecord(artifact.data);

	return (
		<div className="rounded-lg border border-border bg-surface-raised/50">
			<div className="flex items-center gap-2 px-3 py-2.5">
				<Badge className="border-accent/25 bg-accent-muted text-accent">
					{artifact.artifactKind}
				</Badge>
				<span className="text-[11px] text-faint">v{artifact.artifactVersion}</span>
				<StatusBadge status={artifact.status} />
				<span className="flex-1" />
				{artifact.sourceUri ? (
					<a
						className="max-w-72 truncate text-[11px] text-faint hover:text-accent"
						href={artifact.sourceUri}
						rel="noreferrer"
						target="_blank"
					>
						{artifact.sourceUri}
					</a>
				) : null}
			</div>

			{image ? (
				<div className="px-3 pb-2">
					<img
						alt={`${artifact.artifactKind} artifact`}
						className="max-h-56 rounded-md border border-border object-contain"
						loading="lazy"
						src={image}
					/>
				</div>
			) : null}

			{artifact.error != null ? (
				<div className="px-3 pb-2">
					<JsonViewer maxHeight={160} value={artifact.error} />
				</div>
			) : null}

			<div className="flex gap-1.5 px-3 pb-2">
				{(['extracted', 'data'] as const).map((key) => (
					<Button
						className={tab === key ? 'border-accent/50' : ''}
						key={key}
						onClick={() => setTab(tab === key ? null : key)}
					>
						{key}
					</Button>
				))}
			</div>
			{tab ? (
				<div className="px-3 pb-3">
					<JsonViewer maxHeight={320} value={artifact[tab]} />
				</div>
			) : null}
		</div>
	);
}
