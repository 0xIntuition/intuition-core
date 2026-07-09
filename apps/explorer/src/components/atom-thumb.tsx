import { useState } from 'react';
import { classificationHue } from '@/lib/classification';
import { cn } from '@/lib/cn';

/**
 * Small square preview for an atom: the first enrichment/resolved image when
 * one exists, else a deterministic gradient seeded by the atom id — every
 * atom gets stable, distinct artwork without any asset pipeline.
 */
export function AtomThumb({
	id,
	imageUrl,
	size = 28,
	className,
}: {
	id: string;
	imageUrl?: string | null;
	size?: number;
	className?: string;
}) {
	const [broken, setBroken] = useState(false);
	const hue = classificationHue(id);

	if (imageUrl && !broken) {
		return (
			<img
				alt=""
				className={cn('rounded-md border border-border object-cover', className)}
				height={size}
				loading="lazy"
				onError={() => setBroken(true)}
				src={imageUrl}
				style={{ width: size, height: size }}
				width={size}
			/>
		);
	}

	return (
		<div
			aria-hidden
			className={cn('rounded-md border border-border', className)}
			style={{
				width: size,
				height: size,
				background: `linear-gradient(135deg, hsl(${hue} 45% 28%), hsl(${(hue + 60) % 360} 50% 16%))`,
			}}
		/>
	);
}
