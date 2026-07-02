import { findArtifact } from '../context';
import type { DecisionContext } from '../types';
import { match, noMatch, type Rule } from './shared';

type SpotifyPodcastKind = 'show' | 'episode';

const CONFIG = {
	show: {
		id: 'spotify-podcast-show',
		priority: 951,
		schemaType: 'PodcastSeries',
	},
	episode: {
		id: 'spotify-podcast-episode',
		priority: 950,
		schemaType: 'PodcastEpisode',
	},
} as const;

function isSpotifyPodcastReference(value: string | undefined, kind: SpotifyPodcastKind): boolean {
	if (!value) {
		return false;
	}
	if (value.startsWith(`spotify:${kind}:`)) {
		return true;
	}
	try {
		const url = new URL(value);
		return url.hostname.toLowerCase().includes('spotify.') && url.pathname.includes(`/${kind}/`);
	} catch {
		return false;
	}
}

function hasSpotifyPodcastIdentity(context: DecisionContext, kind: SpotifyPodcastKind): boolean {
	const config = CONFIG[kind];
	if (context.identity.schemaType !== config.schemaType) {
		return false;
	}
	return [
		context.identity.canonicalUrl,
		context.identity.canonicalId,
		...context.identity.sameAs,
	].some((value) => isSpotifyPodcastReference(value, kind));
}

function createSpotifyPodcastRule(kind: SpotifyPodcastKind): Rule {
	const config = CONFIG[kind];

	return {
		id: config.id,
		priority: config.priority,
		match: (context) => {
			const artifact = findArtifact(context, 'spotify');
			if (!artifact) {
				if (hasSpotifyPodcastIdentity(context, kind)) {
					return match(config.id, config.priority);
				}
				return noMatch(config.id, config.priority, 'missing-artifact');
			}
			if (artifact.data.type !== kind) {
				return noMatch(config.id, config.priority, 'type-mismatch');
			}
			return match(config.id, config.priority);
		},
	};
}

export const spotifyPodcastShowRule = createSpotifyPodcastRule('show');
export const spotifyPodcastEpisodeRule = createSpotifyPodcastRule('episode');
