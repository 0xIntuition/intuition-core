import { match, type Rule } from './shared';

export const genericRule = {
	id: 'generic',
	priority: 10,
	match: () => match('generic', 10, 'fallback'),
} as const satisfies Rule;
