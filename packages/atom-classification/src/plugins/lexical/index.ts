import { createNonUrlPlugin, type NonUrlV0Profile } from '../shared/non-url';
import { normalizeLexicalTerm } from '../shared/plain-text';
import { isOfflineVerifiedTerm } from './offline-verified-terms';

export const lexicalProfile: NonUrlV0Profile = {
	id: 'lexical',
	classifier: {
		id: 'lexical-verified-word-classifier',
		priority: 50,
		classify: (input) => {
			const normalizedTerm = normalizeLexicalTerm(input);
			if (!normalizedTerm || !isOfflineVerifiedTerm(normalizedTerm)) {
				return null;
			}

			return {
				type: 'text',
				domain: 'lexical',
				subtype: 'word',
				confidence: 0.71,
				meta: {
					tokenCount: 1,
					characterCount: normalizedTerm.length,
					normalizedTerm,
					verificationMode: 'offline',
				},
			};
		},
	},
	canResolve: (classification) =>
		classification.domain === 'lexical' &&
		classification.subtype === 'word' &&
		typeof classification.meta.normalizedTerm === 'string' &&
		isOfflineVerifiedTerm(classification.meta.normalizedTerm),
	resolve: ({ classification, request, now }) => {
		const normalized =
			(typeof classification.meta.normalizedTerm === 'string' &&
				classification.meta.normalizedTerm) ||
			normalizeLexicalTerm(request.input);
		if (!normalized) {
			return null;
		}

		const sourceUrl = `https://en.wiktionary.org/wiki/${encodeURIComponent(normalized)}`;
		const termCode = slugify(normalized);
		return {
			fallbackUsed: true,
			classifications: [
				{
					type: 'DefinedTerm',
					data: {
						'@context': 'https://schema.org/',
						'@type': 'DefinedTerm',
						name: normalized,
						sameAs: [sourceUrl],
						termCode,
					},
					meta: {
						pluginId: 'lexical',
						provider: 'lexical',
						fetchedAt: now,
						sourceUrl,
						confidence: classification.confidence,
					},
				},
			],
		};
	},
};

export function createLexicalPlugin() {
	// The default preset no longer registers lexical automatically. Keep this
	// factory available so callers can opt into offline-verified term handling
	// explicitly via plugin selection or custom preset composition.
	return createNonUrlPlugin({
		pluginId: 'lexical',
		resolverId: 'lexical-resolver',
		profile: lexicalProfile,
	});
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}
