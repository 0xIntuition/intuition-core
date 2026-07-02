import { findArtifact } from '../context';
import { match, noMatch, type Rule } from './shared';

export const brandCompanyRule = {
	id: 'brand-company',
	priority: 840,
	match: (context) =>
		findArtifact(context, 'brand') || findArtifact(context, 'company-profile')
			? match('brand-company', 840)
			: noMatch('brand-company', 840, 'missing-artifact'),
} as const satisfies Rule;
