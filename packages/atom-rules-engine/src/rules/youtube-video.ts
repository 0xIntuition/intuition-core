import { findArtifact, isYouTubeUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const youtubeVideoRule = {
	id: 'youtube-video',
	priority: 920,
	match: (context) => {
		if (
			findArtifact(context, 'youtube') ||
			findArtifact(context, 'oembed') ||
			isYouTubeUrl(context.identity.canonicalUrl)
		) {
			return match('youtube-video', 920);
		}
		return noMatch('youtube-video', 920, 'missing-artifact');
	},
} as const satisfies Rule;
