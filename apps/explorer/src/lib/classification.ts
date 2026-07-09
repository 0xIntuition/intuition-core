/**
 * Visual identity for classification types and pipeline statuses.
 * Classification types are open-ended (schema.org-ish), so known types get
 * curated colors and everything else falls back to a deterministic palette.
 */

const KNOWN_CLASSIFICATION_CLASSES: Record<string, string> = {
	Person: 'bg-info-muted text-info border-info/25',
	SocialMediaAccount: 'bg-info-muted text-info border-info/25',
	Organization: 'bg-warning-muted text-warning border-warning/25',
	SoftwareSourceCode: 'bg-success-muted text-success border-success/25',
	SoftwareApplication: 'bg-success-muted text-success border-success/25',
	WebSite: 'bg-accent-muted text-accent border-accent/25',
	Article: 'bg-accent-muted text-accent border-accent/25',
	EthereumAccount: 'bg-warning-muted text-warning border-warning/25',
	EthereumSmartContract: 'bg-warning-muted text-warning border-warning/25',
	Thing: 'bg-surface-raised text-muted border-border',
	Unknown: 'bg-surface-raised text-faint border-border',
};

const FALLBACK_CLASSES = [
	'bg-accent-muted text-accent border-accent/25',
	'bg-info-muted text-info border-info/25',
	'bg-success-muted text-success border-success/25',
	'bg-warning-muted text-warning border-warning/25',
];

function hashString(value: string): number {
	let hash = 0;
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0;
	}
	return Math.abs(hash);
}

export function classificationClasses(type: string): string {
	return (
		KNOWN_CLASSIFICATION_CLASSES[type] ??
		FALLBACK_CLASSES[hashString(type) % FALLBACK_CLASSES.length] ??
		''
	);
}

/** Deterministic hue for fallback artwork gradients (0–360). */
export function classificationHue(seed: string): number {
	return hashString(seed) % 360;
}

/** Pipeline / artifact status → badge classes. */
export function statusClasses(status: string): string {
	switch (status) {
		case 'completed':
			return 'bg-success-muted text-success border-success/25';
		case 'processing':
			return 'bg-info-muted text-info border-info/25';
		case 'pending':
			return 'bg-surface-raised text-muted border-border';
		case 'failed':
			return 'bg-danger-muted text-danger border-danger/25';
		case 'skipped':
			return 'bg-surface-raised text-faint border-border';
		default:
			return 'bg-surface-raised text-muted border-border';
	}
}
