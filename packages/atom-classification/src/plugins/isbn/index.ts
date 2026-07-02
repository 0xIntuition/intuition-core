import { createNonUrlPlugin, type NonUrlV0Profile } from '../shared/non-url';

const ISBN_PREFIX_REGEX = /^isbn(?::|\s)+/i;
const ISBN_10_REGEX = /^[0-9]{9}[0-9X]$/i;
const ISBN_13_REGEX = /^97[89][0-9]{10}$/;

export const isbnProfile: NonUrlV0Profile = {
	id: 'isbn',
	classifier: {
		id: 'isbn-identifier-classifier',
		priority: 25,
		classify: (input) => {
			const trimmed = input.trim();
			const withoutPrefix = trimmed.replace(ISBN_PREFIX_REGEX, '');
			const compact = withoutPrefix.replace(/[-\s]/g, '').toUpperCase();

			if (ISBN_10_REGEX.test(compact)) {
				return {
					type: 'identifier',
					domain: 'isbn',
					subtype: 'isbn-10',
					confidence: 0.97,
					meta: {
						normalizedIsbn: compact,
						identifierType: 'ISBN10',
					},
				};
			}

			if (ISBN_13_REGEX.test(compact)) {
				return {
					type: 'identifier',
					domain: 'isbn',
					subtype: 'isbn-13',
					confidence: 0.98,
					meta: {
						normalizedIsbn: compact,
						identifierType: 'ISBN13',
					},
				};
			}

			return null;
		},
	},
	canResolve: (classification) => classification.domain === 'isbn',
	resolve: ({ classification, request, now }) => {
		const normalized =
			(typeof classification.meta.normalizedIsbn === 'string' &&
				classification.meta.normalizedIsbn) ||
			request.input.trim();
		const sourceUrl = `https://www.worldcat.org/isbn/${normalized}`;
		const name = `Book (ISBN ${normalized})`;

		return {
			fallbackUsed: true,
			atoms: [
				{
					schemaType: 'Book',
					category: 'thing',
					title: name,
					canonicalId: `isbn:${normalized}`,
					sameAs: [sourceUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'Book',
						name,
						isbn: normalized,
						sameAs: [sourceUrl],
					},
					metadata: {
						pluginId: 'isbn',
						provider: 'isbn',
						fetchedAt: now,
						sourceUrl,
						identifierType: classification.subtype,
					},
				},
			],
		};
	},
};

export function createIsbnPlugin() {
	return createNonUrlPlugin({
		pluginId: 'isbn',
		resolverId: 'isbn-resolver',
		profile: isbnProfile,
	});
}
