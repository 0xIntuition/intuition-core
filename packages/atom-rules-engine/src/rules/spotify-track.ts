import { findArtifact } from '../context';
import type { DecisionContext } from '../types';
import { match, noMatch, type Rule } from './shared';

function isSpotifyTrackReference(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	if (value.startsWith('spotify:track:')) {
		return true;
	}
	try {
		const url = new URL(value);
		return url.hostname.toLowerCase().includes('spotify.') && url.pathname.includes('/track/');
	} catch {
		return false;
	}
}

function hasSpotifyTrackIdentity(context: DecisionContext): boolean {
	if (context.identity.schemaType !== 'MusicRecording') {
		return false;
	}
	return [
		context.identity.canonicalUrl,
		context.identity.canonicalId,
		...context.identity.sameAs,
	].some(isSpotifyTrackReference);
}

export const spotifyTrackRule = {
	id: 'spotify-track',
	priority: 955,
	match: (context) => {
		const artifact = findArtifact(context, 'spotify');
		if (!artifact) {
			if (hasSpotifyTrackIdentity(context)) {
				return match('spotify-track', 955);
			}
			return noMatch('spotify-track', 955, 'missing-artifact');
		}
		if (artifact.data.type !== 'track') {
			return noMatch('spotify-track', 955, 'type-mismatch');
		}
		return match('spotify-track', 955);
	},
} as const satisfies Rule;
