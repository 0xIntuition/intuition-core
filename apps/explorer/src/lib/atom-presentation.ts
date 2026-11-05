import type { AtomContextItem, AtomListItem, TermSummary } from './api';
import { previewData } from './format';
import { extractImageFromRecord } from './images';

type PresentableAtom = Pick<AtomListItem, 'id' | 'data' | 'dataResolved' | 'display' | 'identity'>;

export function parseSemanticReadsFlag(value: string | boolean | undefined): boolean {
	return (
		value === true || (typeof value === 'string' && ['true', '1'].includes(value.toLowerCase()))
	);
}

/** Independent UI gate: an enabled API cannot silently change Explorer labels. */
export const ATOM_SEMANTIC_READS_ENABLED = parseSemanticReadsFlag(
	import.meta.env.VITE_ATOM_SEMANTIC_READS_ENABLED
);

/** Human-facing label priority: resolved display, resolved payload, raw bytes, term id. */
export function atomDisplayLabel(
	atom: PresentableAtom,
	maxLength = 96,
	semanticReadsEnabled = ATOM_SEMANTIC_READS_ENABLED
): string {
	const resolvedName = semanticReadsEnabled
		? readString(toRecord(atom.dataResolved)?.name)
		: undefined;
	const label =
		(semanticReadsEnabled ? (atom.display?.name ?? resolvedName) : undefined) ??
		atom.data ??
		atom.id;
	return previewData(label, maxLength) || atom.id;
}

/** A canonical IID remains useful as a secondary identity, never as the preferred label. */
export function atomSecondaryIdentity(
	atom: PresentableAtom,
	semanticReadsEnabled = ATOM_SEMANTIC_READS_ENABLED
): string | null {
	return semanticReadsEnabled ? (atom.identity?.canonical ?? atom.identity?.raw ?? null) : null;
}

export function atomDisplayImage(
	atom: Pick<AtomListItem, 'dataResolved' | 'display'>,
	semanticReadsEnabled = ATOM_SEMANTIC_READS_ENABLED
): string | null {
	return (
		(semanticReadsEnabled ? atom.display?.image : undefined) ??
		extractImageFromRecord(atom.dataResolved)
	);
}

export function termDisplayLabel(
	term: NonNullable<TermSummary>,
	maxLength = 42,
	semanticReadsEnabled = ATOM_SEMANTIC_READS_ENABLED
): string {
	const resolvedName = semanticReadsEnabled
		? readString(toRecord(term.dataResolved)?.name)
		: undefined;
	return previewData(
		(semanticReadsEnabled ? (term.display?.name ?? resolvedName) : undefined) ?? term.data,
		maxLength
	);
}

/**
 * Context entries are untrusted on-chain evidence. Only web URLs without
 * embedded credentials become clickable; all other values remain visible as
 * text for inspection and copying.
 */
export function safeContextHref(context: Pick<AtomContextItem, 'uri'>): string | null {
	if (!context.uri) {
		return null;
	}
	try {
		const url = new URL(context.uri);
		if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
			return null;
		}
		return url.href;
	} catch {
		return null;
	}
}

export function contextDisplayValue(context: AtomContextItem): string {
	return context.uri ?? context.raw ?? '(unreadable context bytes)';
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function readString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	if (Array.isArray(value)) {
		return value.map(readString).find((entry): entry is string => entry !== undefined);
	}
	return undefined;
}
