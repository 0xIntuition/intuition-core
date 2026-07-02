import { findArtifact, isAppleMusicUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const appleMusicSongRule = {
	id: 'apple-music-song',
	priority: 960,
	match: (context) => {
		const artifact = findArtifact(context, 'apple-music');
		const url = context.identity.canonicalUrl;
		if (!artifact && !isAppleMusicUrl(url)) {
			return noMatch('apple-music-song', 960, 'missing-artifact');
		}
		if (artifact && artifact.data.type !== 'song') {
			return noMatch('apple-music-song', 960, 'type-mismatch');
		}
		return match('apple-music-song', 960);
	},
} as const satisfies Rule;
