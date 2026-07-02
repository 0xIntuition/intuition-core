import type { ResolverAtom } from '../../plugins';
import { toStringMaybe } from '../shared/helpers';
import {
	createOpenGraphPlatformAdapter,
	type OpenGraphMetadata,
	type OpenGraphPlatformAdapter,
} from '../shared/opengraph';
import {
	buildXPostAtom,
	buildXProfileAtom,
	normalizeXCanonicalUrl,
	normalizeXHandle,
} from './shared';

export type XOpenGraphAdapterOptions = {
	fetch?: Parameters<typeof createOpenGraphPlatformAdapter>[0]['fetch'];
	headers?: Record<string, string>;
};

export type XOpenGraphAdapter = OpenGraphPlatformAdapter;

export function createXOpenGraphAdapter(options: XOpenGraphAdapterOptions = {}): XOpenGraphAdapter {
	return createOpenGraphPlatformAdapter({
		fetch: options.fetch,
		headers: options.headers,
		domains: ['x'],
		map: ({ classification, canonicalUrl, metadata }) => {
			if (classification.subtype === 'post') {
				return buildXPostOpenGraphAtom({
					canonicalUrl,
					handle: toStringMaybe(classification.meta.handle),
					postId: toStringMaybe(classification.meta.postId),
					metadata,
				});
			}

			if (classification.subtype === 'profile') {
				return buildXProfileOpenGraphAtom({
					canonicalUrl,
					handle: toStringMaybe(classification.meta.handle),
					metadata,
				});
			}

			return null;
		},
	});
}

function buildXPostOpenGraphAtom(input: {
	canonicalUrl: string;
	handle?: string;
	postId?: string;
	metadata: OpenGraphMetadata;
}): ResolverAtom | null {
	const handle = normalizeXHandle(input.handle);
	const identifier = input.postId;
	const resolvedCanonicalUrl = normalizeXCanonicalUrl(input.metadata.url) ?? input.canonicalUrl;
	const description = resolveXOpenGraphDescription(input.metadata);
	if (!hasUsableXOpenGraphSignal(input.metadata, description)) {
		return null;
	}

	if (!identifier && !handle && !description) {
		return null;
	}

	return buildXPostAtom({
		canonicalUrl: resolvedCanonicalUrl,
		identifier: identifier ?? slugifyXIdentifier(resolvedCanonicalUrl),
		handle,
		authorHandle: handle,
		authorDisplayName: handle ? `@${handle}` : undefined,
		text: description,
		provider: 'x-opengraph',
		resolutionMode: 'identity-only',
		extraMetadata: {
			...(input.metadata.title ? { ogTitle: input.metadata.title } : {}),
			...(input.metadata.description ? { ogDescription: input.metadata.description } : {}),
			...(input.metadata.image ? { ogImage: input.metadata.image } : {}),
			...(input.metadata.documentTitle ? { documentTitle: input.metadata.documentTitle } : {}),
		},
	});
}

function buildXProfileOpenGraphAtom(input: {
	canonicalUrl: string;
	handle?: string;
	metadata: OpenGraphMetadata;
}): ResolverAtom | null {
	const handle = normalizeXHandle(input.handle);
	if (!handle) {
		return null;
	}

	const resolvedCanonicalUrl = normalizeXCanonicalUrl(input.metadata.url) ?? input.canonicalUrl;
	const description = resolveXOpenGraphDescription(input.metadata);
	if (!hasUsableXOpenGraphSignal(input.metadata, description)) {
		return null;
	}

	return buildXProfileAtom({
		canonicalUrl: resolvedCanonicalUrl,
		handle,
		description,
		provider: 'x-opengraph',
		resolutionMode: 'identity-only',
		extraMetadata: {
			...(input.metadata.title ? { ogTitle: input.metadata.title } : {}),
			...(input.metadata.description ? { ogDescription: input.metadata.description } : {}),
			...(input.metadata.image ? { ogImage: input.metadata.image } : {}),
			...(input.metadata.documentTitle ? { documentTitle: input.metadata.documentTitle } : {}),
		},
	});
}

function resolveXOpenGraphDescription(metadata: OpenGraphMetadata): string | undefined {
	const description =
		toStringMaybe(metadata.description) ??
		toStringMaybe(metadata.title) ??
		toStringMaybe(metadata.documentTitle);
	if (!description) {
		return undefined;
	}

	if (description === 'X' || description === 'Twitter') {
		return undefined;
	}

	return description;
}

function hasUsableXOpenGraphSignal(
	metadata: OpenGraphMetadata,
	description: string | undefined
): boolean {
	if (description) {
		return true;
	}

	return !!(
		toStringMaybe(metadata.image) ||
		toStringMaybe(metadata.title) ||
		toStringMaybe(metadata.documentTitle)
	);
}

function slugifyXIdentifier(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}
