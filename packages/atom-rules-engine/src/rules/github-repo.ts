import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const githubRepoRule = {
	id: 'github-repo',
	priority: 950,
	match: (context) =>
		findArtifact(context, 'github-repo')
			? match('github-repo', 950)
			: noMatch('github-repo', 950, 'missing-artifact'),
} as const satisfies Rule;
