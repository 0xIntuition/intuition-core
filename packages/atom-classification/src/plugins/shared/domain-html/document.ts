import { toRecordMaybe, toStringMaybe } from '../helpers';

export function extractCanonicalUrl(html: string): string | undefined {
	return extractAttributeValue(
		html,
		/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i
	);
}

export function extractMetaContent(html: string, name: string): string | undefined {
	const escapedName = escapeRegExp(name);
	const content =
		extractAttributeValue(
			html,
			new RegExp(`<meta[^>]+name=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i')
		) ??
		extractAttributeValue(
			html,
			new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escapedName}["'][^>]*>`, 'i')
		) ??
		extractAttributeValue(
			html,
			new RegExp(
				`<meta[^>]+property=["']${escapedName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
				'i'
			)
		) ??
		extractAttributeValue(
			html,
			new RegExp(
				`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escapedName}["'][^>]*>`,
				'i'
			)
		);

	return decodeHtmlEntities(content);
}

export function extractDocumentTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	return decodeHtmlEntities(stripHtml(match?.[1]));
}

export function extractElementTextById(html: string, id: string): string | undefined {
	const escapedId = escapeRegExp(id);
	const match = html.match(
		new RegExp(`<([a-z0-9]+)[^>]*id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i')
	);
	if (!match) {
		return undefined;
	}

	return decodeHtmlEntities(stripHtml(match[2]));
}

export function extractAttributeValue(html: string, pattern: RegExp): string | undefined {
	const match = html.match(pattern);
	return decodeHtmlEntities(match?.[1]);
}

export function extractPrimaryJsonLd(html: string): Record<string, unknown> | undefined {
	const matches = html.matchAll(
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
	);

	for (const match of matches) {
		const raw = match[1]?.trim();
		if (!raw) {
			continue;
		}

		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				for (const entry of parsed) {
					const record = toRecordMaybe(entry);
					if (record && toStringMaybe(record['@type'])) {
						return record;
					}
				}
				continue;
			}

			const record = toRecordMaybe(parsed);
			if (record && toStringMaybe(record['@type'])) {
				return record;
			}
		} catch {}
	}

	return undefined;
}

export function stripHtml(value: string | undefined): string {
	return (value ?? '').replace(/<[^>]+>/g, ' ');
}

export function decodeHtmlEntities(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	return (
		value
			// Numeric entities — hex (&#xHH;) and decimal (&#NN;). These cover
			// the common cases scrapers leak (e.g. &#x27; for apostrophe).
			.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
				String.fromCodePoint(Number.parseInt(hex, 16))
			)
			.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
			// Named entities
			.replace(/&amp;/g, '&')
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&nbsp;/g, ' ')
			.trim()
	);
}

export function normalizeWhitespace(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const normalized = value.replace(/\s+/g, ' ').trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStringArray(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
