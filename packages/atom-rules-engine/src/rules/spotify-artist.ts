import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const spotifyArtistRule = {
	id: 'spotify-artist',
	priority: 954,
	match: (context) => {
		const artifact = findArtifact(context, 'spotify');
		if (!artifact) {
			return noMatch('spotify-artist', 954, 'missing-artifact');
		}
		if (artifact.data.type !== 'artist') {
			return noMatch('spotify-artist', 954, 'type-mismatch');
		}
		return match('spotify-artist', 954);
	},
} as const satisfies Rule;
