import { describe, expect, it } from 'bun:test';
import {
	buildUrlFirstClassifiedAtomInput,
	hasArtifactOfType,
	readWikibaseItemFromArtifacts,
	resolveUrlFirstClassification,
} from '../src/extraction/url-first';
import type { EnrichmentArtifact } from '../src/types';

const WIKIPEDIA_URL = 'https://en.wikipedia.org/wiki/Vitalik_Buterin';

function artifact(artifactType: string, data: Record<string, unknown>): EnrichmentArtifact {
	return {
		artifact_type: artifactType,
		data,
		meta: {
			pluginId: artifactType,
			provider: artifactType,
			fetchedAt: '2026-06-10T00:00:00.000Z',
		},
	};
}

describe('resolveUrlFirstClassification', () => {
	it('maps the person spec to the person atom type with required keys', () => {
		const classification = resolveUrlFirstClassification('person');
		expect(classification?.atomType).toBe('person');
		expect(classification?.type).toBe('Person');
		expect(classification?.preset).toBe('default');
		expect(classification?.requiredFieldKeys).toEqual(['givenName', 'familyName']);
	});

	it('derives presets from the spec (music for recordings, company for companies)', () => {
		expect(resolveUrlFirstClassification('music-recording')?.preset).toBe('music');
		expect(resolveUrlFirstClassification('company')?.preset).toBe('company');
		expect(resolveUrlFirstClassification('ethereum-erc20')?.preset).toBe('crypto');
	});

	it('returns null for unknown slugs', () => {
		expect(resolveUrlFirstClassification('not-a-spec')).toBeNull();
	});
});

describe('buildUrlFirstClassifiedAtomInput', () => {
	it('builds a classified input with the url as both url and sameAs plus a url hint', () => {
		const classification = resolveUrlFirstClassification('person');
		if (!classification) throw new Error('person spec missing');
		const input = buildUrlFirstClassifiedAtomInput(
			classification,
			WIKIPEDIA_URL,
			'2026-06-10T00:00:00.000Z'
		);

		expect(input.atomType).toBe('person');
		expect(input.jsonLd['@type']).toBe('Person');
		expect(input.jsonLd.url).toBe(WIKIPEDIA_URL);
		expect(input.jsonLd.sameAs).toEqual([WIKIPEDIA_URL]);
		expect(input.hints?.url).toBe(WIKIPEDIA_URL);
		// No name hint: the wikidata plugin must never fall back to fuzzy
		// name search in the URL-first flow.
		expect(input.hints?.name).toBeUndefined();
	});
});

describe('readWikibaseItemFromArtifacts', () => {
	it('reads the wikibase item from a wikipedia artifact and normalizes casing', () => {
		const artifacts = [
			artifact('opengraph', { title: 'Vitalik Buterin - Wikipedia' }),
			artifact('wikipedia', { title: 'Vitalik Buterin', wikibaseItem: 'q16197959' }),
		];
		expect(readWikibaseItemFromArtifacts(artifacts)).toBe('Q16197959');
	});

	it('ignores malformed ids and non-wikipedia artifacts', () => {
		expect(
			readWikibaseItemFromArtifacts([artifact('wikipedia', { wikibaseItem: 'not-an-id' })])
		).toBeUndefined();
		expect(
			readWikibaseItemFromArtifacts([artifact('wikidata', { entityId: 'Q1' })])
		).toBeUndefined();
	});
});

describe('hasArtifactOfType', () => {
	it('detects artifact presence by type', () => {
		const artifacts = [artifact('wikidata', { entityId: 'Q1' })];
		expect(hasArtifactOfType(artifacts, 'wikidata')).toBe(true);
		expect(hasArtifactOfType(artifacts, 'opengraph')).toBe(false);
	});
});
