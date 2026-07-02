import { match, noMatch, type Rule } from './shared';

export const websiteRule = {
	id: 'website',
	priority: 880,
	match: (context) =>
		context.identity.schemaType === 'WebSite'
			? match('website', 880)
			: noMatch('website', 880, 'identity-mismatch'),
} as const satisfies Rule;
