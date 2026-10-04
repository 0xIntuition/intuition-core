import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../../atom-classification/src/engine';
import { createSpotifyPlugin, createTypeProfilesPlugin } from '../../atom-classification/src/index';
import { toClassifiedAtomInput } from '../src/handoff';
import { classifiedAtomInputSchema } from '../src/types';

describe('Spotify music classification handoff contract', () => {
	for (const [kind, category, schemaType] of [
		['track', 'song', 'MusicRecording'],
		['album', 'music-album', 'MusicAlbum'],
		['artist', 'artist', 'MusicGroup'],
	] as const) {
		for (const shape of ['publishable', 'classifications', 'atoms'] as const) {
			it(`preserves ${kind} category and JSON-LD type through the ${shape} handoff`, async () => {
				const url = `https://open.spotify.com/${kind}/abc123`;
				const result = await createClassificationEngine({
					runtime: 'server',
					plugins: [createTypeProfilesPlugin(), createSpotifyPlugin()],
				}).classify({
					input: url,
					mode: 'server-only',
					classificationSessionId: `handoff-${kind}-${shape}`,
				});
				expect(result.resolved).toBeDefined();
				// Passing the complete result also checks the public consumer TypeScript boundary.
				const complete = toClassifiedAtomInput(url, result);
				const input = toClassifiedAtomInput(url, {
					classification: result.classification,
					resolved: { [shape]: result.resolved![shape] },
				});
				expect(input).toBeDefined();
				expect(classifiedAtomInputSchema.safeParse(input).success).toBe(true);
				expect(input).toMatchObject({ atomType: category, jsonLd: { '@type': schemaType } });
				expect(complete).toMatchObject({ atomType: category, jsonLd: { '@type': schemaType } });
				expect(result.resolved?.atoms[0]?.canonicalId).toBe(`spotify:${kind}:abc123`);
			});
		}
	}
});
