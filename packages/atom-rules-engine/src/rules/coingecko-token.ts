import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const coingeckoTokenRule = {
	id: 'coingecko-token',
	priority: 860,
	match: (context) =>
		findArtifact(context, 'token-metadata')
			? match('coingecko-token', 860)
			: noMatch('coingecko-token', 860, 'missing-artifact'),
} as const satisfies Rule;
