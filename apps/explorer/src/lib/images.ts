/**
 * Best-effort image extraction from loose enrichment/parse payloads.
 * Field priority mirrors what providers actually emit (opengraph, github,
 * spotify, wikipedia, …).
 */
const IMAGE_FIELDS = [
	'highResImageUrl',
	'profileImageUrl',
	'avatarUrl',
	'image',
	'imageUrl',
	'image_url',
	'avatar',
	'logo',
	'ogImage',
	'og:image',
	'thumbnail',
	'thumbnailUrl',
	'icon',
	'faviconUrl',
	'src',
] as const;

/** ipfs:// → public gateway; everything else passes through. */
export function resolveImageUrl(url: string): string {
	if (url.startsWith('ipfs://')) {
		return url.replace('ipfs://', 'https://ipfs.io/ipfs/');
	}
	return url;
}

function isRenderableUrl(value: string): boolean {
	return (
		value.startsWith('http://') ||
		value.startsWith('https://') ||
		value.startsWith('data:') ||
		value.startsWith('ipfs://')
	);
}

/** First renderable image URL found in a loose record, else null. */
export function extractImageFromRecord(record: unknown): string | null {
	if (typeof record !== 'object' || record === null) {
		return null;
	}
	const data = record as Record<string, unknown>;

	for (const field of IMAGE_FIELDS) {
		const value = data[field];
		if (typeof value === 'string' && isRenderableUrl(value)) {
			return resolveImageUrl(value);
		}
		// Nested `{ image: { url } }` shape (json-ld and friends).
		if (typeof value === 'object' && value !== null) {
			const nested = (value as Record<string, unknown>).url;
			if (typeof nested === 'string' && isRenderableUrl(nested)) {
				return resolveImageUrl(nested);
			}
		}
	}
	return null;
}
