import { findArtifact, isEtherscanUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const etherscanContractRule = {
	id: 'etherscan-contract',
	priority: 900,
	match: (context) => {
		if (findArtifact(context, 'etherscan') || isEtherscanUrl(context.identity.canonicalUrl)) {
			return match('etherscan-contract', 900);
		}
		return noMatch('etherscan-contract', 900, 'missing-artifact');
	},
} as const satisfies Rule;
