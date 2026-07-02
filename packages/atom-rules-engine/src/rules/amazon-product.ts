import { findArtifact, isAmazonUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const amazonProductRule = {
	id: 'amazon-product',
	priority: 930,
	match: (context) => {
		const artifact = findArtifact(context, 'product-listing');
		if (artifact) {
			return match('amazon-product', 930);
		}
		if (context.identity.category === 'product' && isAmazonUrl(context.identity.canonicalUrl)) {
			return match('amazon-product', 930);
		}
		return noMatch('amazon-product', 930, 'identity-mismatch');
	},
} as const satisfies Rule;
