import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../src/engine';
import { createV0TypeProfilesPlugin } from '../src/plugins/index';

const V0_TARGET_CATEGORY_FIXTURES = [
	{ type: 'Person', category: 'person', name: 'Ada Lovelace' },
	{ type: 'Place', category: 'place', name: 'Paris' },
	{ type: 'Thing', category: 'thing', name: 'Generic Thing' },
	{ type: 'Organization', category: 'company', name: 'Open Source Initiative' },
	{ type: 'Product', category: 'product', name: 'Mechanical Keyboard' },
	{ type: 'MusicRecording', category: 'song', name: 'Imagine' },
	{ type: 'PodcastSeries', category: 'podcast', name: 'Bankless' },
	{ type: 'PodcastEpisode', category: 'podcast', name: 'The Future of Onchain Reputation' },
	{ type: 'SoftwareApplication', category: 'software', name: 'Notion' },
] as const;

describe('v0 type profile fixtures', () => {
	it('registers profile fixtures for every v0 target category', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin()],
		});

		await engine.init();
		const registeredByType = new Map(
			engine.listTypes().map((definition) => [definition.type, definition])
		);

		for (const fixture of V0_TARGET_CATEGORY_FIXTURES) {
			const definition = registeredByType.get(fixture.type);
			expect(definition?.category).toBe(fixture.category);
			expect(definition?.requiredFields.includes('name')).toBe(true);
			expect(() =>
				definition?.schema.parse({
					'@context': 'https://schema.org',
					'@type': fixture.type,
					name: fixture.name,
				})
			).not.toThrow();
		}
	});
});
