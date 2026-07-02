import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const spotifyPlaylistRule = {
	id: 'spotify-playlist',
	priority: 952,
	match: (context) => {
		const artifact = findArtifact(context, 'spotify');
		if (!artifact) {
			return noMatch('spotify-playlist', 952, 'missing-artifact');
		}
		if (artifact.data.type !== 'playlist') {
			return noMatch('spotify-playlist', 952, 'type-mismatch');
		}
		return match('spotify-playlist', 952);
	},
} as const satisfies Rule;
