import { isXUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const xPostRule = {
	id: 'x-post',
	priority: 890,
	match: (context) => {
		const url = context.identity.canonicalUrl;
		const canonicalId = context.identity.canonicalId;
		if (
			(url && isXUrl(url) && url.includes('/status/')) ||
			canonicalId?.startsWith('x:post:') ||
			context.identity.schemaType === 'SocialMediaPosting'
		) {
			return match('x-post', 890);
		}
		return noMatch('x-post', 890, 'identity-mismatch');
	},
} as const satisfies Rule;
