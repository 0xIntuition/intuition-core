import type { ResolverAtom } from '../../../plugins';
import type { ClassificationRuntime } from '../../../types';
import { toStringMaybe } from '../helpers';
import type { PlatformDomain, PlatformStageAdapter } from '../platform';
import { type DomainHtmlFetchLike, resolveDomainHtmlFetch } from './fetch';

export type SequencedDomainHtmlSource = {
	id: string;
	resolve(input: {
		runtime: ClassificationRuntime;
		domain: PlatformDomain;
		subtype: string;
		classificationMeta: Record<string, unknown>;
		canonicalUrl: string;
		requestInput: string;
		fetcher: DomainHtmlFetchLike;
	}): Promise<ResolverAtom | null | undefined> | ResolverAtom | null | undefined;
};

export function createSequencedDomainHtmlAdapter(input: {
	domain: PlatformDomain;
	subtypes: string[];
	fetch?: DomainHtmlFetchLike;
	sources: SequencedDomainHtmlSource[];
}): PlatformStageAdapter {
	return async ({ runtime, domain, classification, canonicalUrl, requestInput }) => {
		if (runtime !== 'server' || domain !== input.domain) {
			return null;
		}

		const subtype = toStringMaybe(classification.subtype);
		if (!subtype || !input.subtypes.includes(subtype)) {
			return null;
		}

		const fetcher = resolveDomainHtmlFetch(input.fetch);
		if (!fetcher) {
			return null;
		}

		// Sources are tried in a fixed order so domain-html remains deterministic.
		// The first source that can build an identity-safe atom wins.
		for (const source of input.sources) {
			const atom = await source.resolve({
				runtime,
				domain,
				subtype,
				classificationMeta: classification.meta,
				canonicalUrl,
				requestInput,
				fetcher,
			});
			if (atom) {
				return atom;
			}
		}

		return null;
	};
}
