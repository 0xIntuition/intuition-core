import { findArtifact, isXUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const xProfileRule = {
	id: 'x-profile',
	priority: 980,
	match: (context) => {
		const artifact = findArtifact(context, 'x-profile') ?? findArtifact(context, 'twitter-profile');
		const url = context.identity.canonicalUrl;
		if (
			context.identity.canonicalId?.startsWith('x:post:') ||
			context.identity.schemaType === 'SocialMediaPosting'
		) {
			return noMatch('x-profile', 980, 'identity-mismatch');
		}
		if (!artifact && !isXUrl(url)) {
			return noMatch('x-profile', 980, 'missing-artifact');
		}
		if (url?.includes('/status/')) {
			return noMatch('x-profile', 980, 'url-mismatch');
		}
		return match('x-profile', 980);
	},
} as const satisfies Rule;
