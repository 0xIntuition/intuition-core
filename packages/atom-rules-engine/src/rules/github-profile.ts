import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const githubProfileRule = {
	id: 'github-profile',
	priority: 830,
	match: (context) =>
		findArtifact(context, 'github-user')
			? match('github-profile', 830)
			: noMatch('github-profile', 830, 'missing-artifact'),
} as const satisfies Rule;
