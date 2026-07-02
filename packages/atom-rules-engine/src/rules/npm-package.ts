import { findArtifact, isNpmUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const npmPackageRule = {
	id: 'npm-package',
	priority: 820,
	match: (context) =>
		findArtifact(context, 'npm-package') || isNpmUrl(context.identity.canonicalUrl)
			? match('npm-package', 820)
			: noMatch('npm-package', 820, 'missing-artifact'),
} as const satisfies Rule;
