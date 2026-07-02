import { findArtifact, isTmdbUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const tmdbMovieRule = {
	id: 'tmdb-movie',
	priority: 850,
	match: (context) => {
		const artifact = findArtifact(context, 'tmdb');
		if (!artifact && !isTmdbUrl(context.identity.canonicalUrl)) {
			return noMatch('tmdb-movie', 850, 'missing-artifact');
		}
		if (artifact && artifact.data.mediaType !== 'movie') {
			return noMatch('tmdb-movie', 850, 'type-mismatch');
		}
		return match('tmdb-movie', 850);
	},
} as const satisfies Rule;
