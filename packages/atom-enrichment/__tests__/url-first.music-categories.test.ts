import { describe, expect, it } from 'bun:test';

import {
	buildUrlFirstClassifiedAtomInput,
	resolveUrlFirstClassification,
} from '../src/extraction/url-first';

// URL-first enrichment must carry the music categories the classifier emits
// (albums and artists are not songs) while keeping the music preset for all three.
describe('url-first music categories', () => {
	const cases = [
		{ slug: 'music-album', atomType: 'music-album', type: 'MusicAlbum' },
		{ slug: 'music-group', atomType: 'artist', type: 'MusicGroup' },
		{ slug: 'music-recording', atomType: 'song', type: 'MusicRecording' },
	] as const;

	for (const { slug, atomType, type } of cases) {
		it(`maps ${slug} to atomType ${atomType} with the music preset`, () => {
			const classification = resolveUrlFirstClassification(slug);
			expect(classification, slug).not.toBeNull();
			expect(classification?.atomType).toBe(atomType);
			expect(classification?.type).toBe(type);
			expect(classification?.preset).toBe('music');
			const input = buildUrlFirstClassifiedAtomInput(
				classification!,
				`https://open.spotify.com/${slug}/abc123`,
				'2026-10-04T00:00:00.000Z'
			);
			expect(input.atomType).toBe(atomType);
			expect(input.jsonLd['@type']).toBe(type);
		});
	}
});
