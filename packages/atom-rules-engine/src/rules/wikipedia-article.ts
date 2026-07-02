import { findArtifact, isWikipediaUrl } from '../context';
import { match, noMatch, type Rule } from './shared';

export const wikipediaArticleRule = {
	id: 'wikipedia-article',
	priority: 910,
	match: (context) => {
		if (
			findArtifact(context, 'wikipedia') ||
			findArtifact(context, 'wikidata') ||
			isWikipediaUrl(context.identity.canonicalUrl)
		) {
			return match('wikipedia-article', 910);
		}
		return noMatch('wikipedia-article', 910, 'missing-artifact');
	},
} as const satisfies Rule;
