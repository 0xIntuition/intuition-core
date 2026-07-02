import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const spotifyAlbumRule = {
	id: 'spotify-album',
	priority: 953,
	match: (context) => {
		const artifact = findArtifact(context, 'spotify');
		if (!artifact) {
			return noMatch('spotify-album', 953, 'missing-artifact');
		}
		if (artifact.data.type !== 'album') {
			return noMatch('spotify-album', 953, 'type-mismatch');
		}
		return match('spotify-album', 953);
	},
} as const satisfies Rule;
