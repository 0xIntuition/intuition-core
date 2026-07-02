import { createNonUrlPlugin, type NonUrlV0Profile } from '../shared/non-url';
import { matchPlainTextInput } from '../shared/plain-text';

const PLAIN_TEXT_PLUGIN_ID = 'plain-text';
const PLAIN_TEXT_PROVIDER = 'plain-text';

export const plainTextProfile: NonUrlV0Profile = {
	id: PLAIN_TEXT_PLUGIN_ID,
	classifier: {
		id: 'plain-text-fallback-classifier',
		priority: 60,
		classify: (input) => {
			const match = matchPlainTextInput(input);
			if (!match) {
				return null;
			}

			return {
				type: 'text',
				domain: PLAIN_TEXT_PLUGIN_ID,
				subtype: match.tokenCount <= 1 ? 'word' : 'phrase',
				confidence: match.tokenCount <= 1 ? 0.64 : 0.61,
				meta: {
					tokenCount: match.tokenCount,
					characterCount: match.characterCount,
				},
			};
		},
	},
	canResolve: (classification) => classification.domain === PLAIN_TEXT_PLUGIN_ID,
	resolve: ({ classification, request, now }) => {
		const match = matchPlainTextInput(request.input);
		if (!match) {
			return null;
		}

		return {
			fallbackUsed: true,
			classifications: [
				{
					type: 'Thing',
					data: {
						'@context': 'https://schema.org/',
						'@type': 'Thing',
						name: match.value,
					},
					meta: {
						pluginId: PLAIN_TEXT_PLUGIN_ID,
						provider: PLAIN_TEXT_PROVIDER,
						fetchedAt: now,
						confidence: classification.confidence,
					},
				},
			],
		};
	},
};

export function createPlainTextPlugin() {
	return createNonUrlPlugin({
		pluginId: PLAIN_TEXT_PLUGIN_ID,
		resolverId: 'plain-text-resolver',
		profile: plainTextProfile,
	});
}
