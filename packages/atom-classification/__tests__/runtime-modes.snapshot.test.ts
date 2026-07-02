import { describe, expect, it } from 'bun:test';
import { createServerEngine } from '../src/server';
import type { ClassificationMode, ClassificationResult } from '../src/types';
import { createDefaultTestPlugins } from './helpers/default-plugins';

const SNAPSHOT_TIME = '2026-02-11T00:00:00.000Z';
const INPUT = 'ISBN 9780306406157';

describe('runtime mode output snapshots', () => {
	const modes: ClassificationMode[] = ['client-only', 'progressive', 'server-only'];

	for (const mode of modes) {
		it(`matches deterministic snapshot for ${mode}`, async () => {
			const engine = createServerEngine({
				now: () => new Date(SNAPSHOT_TIME),
				plugins: createDefaultTestPlugins(),
			});

			const result = await engine.classify({
				input: INPUT,
				mode,
				classificationSessionId: `snapshot-${mode}`,
			});

			expect(projectModeSnapshot(result)).toEqual(expectedModeSnapshots[mode]);
		});
	}
});

function projectModeSnapshot(result: ClassificationResult) {
	const atom = result.resolved?.atoms[0];
	return {
		ok: result.ok,
		status: result.status,
		contractVersion: result.contractVersion,
		runtime: result.runtime,
		mode: result.mode,
		classificationSessionId: result.classificationSessionId,
		policy: result.policy,
		message: result.message,
		receivedAt: result.receivedAt,
		classification: result.classification,
		resolved: result.resolved
			? {
					resolverId: result.resolved.resolverId,
					resolverChain: result.resolved.resolverChain,
					dedupeKey: result.resolved.dedupeKey,
					fallbackUsed: result.resolved.fallbackUsed,
					atom: atom
						? {
								schemaType: atom.schemaType,
								category: atom.category,
								title: atom.title,
								description: atom.description,
								canonicalId: atom.canonicalId,
								sameAs: atom.sameAs,
								source: atom.source,
								metadata: atom.metadata,
								data: atom.data,
							}
						: null,
				}
			: null,
		provenance: result.provenance,
		debug: result.debug,
	};
}

const expectedModeSnapshots: Record<ClassificationMode, ReturnType<typeof projectModeSnapshot>> = {
	'client-only': {
		ok: true,
		status: 'complete',
		contractVersion: 'cpkg-02',
		runtime: 'server',
		mode: 'client-only',
		classificationSessionId: 'snapshot-client-only',
		policy: {
			runClientClassification: true,
			runServerEnrichment: false,
			runDedupe: false,
			runAiFallback: false,
			includeProvenance: true,
			requestedServerTiers: [],
		},
		message: 'Resolved by isbn-resolver with 1 candidate atom.',
		receivedAt: SNAPSHOT_TIME,
		classification: {
			type: 'identifier',
			domain: 'isbn',
			subtype: 'isbn-13',
			confidence: 0.98,
			meta: {
				normalizedIsbn: '9780306406157',
				identifierType: 'ISBN13',
			},
		},
		resolved: {
			resolverId: 'isbn-resolver',
			resolverChain: ['isbn-resolver'],
			dedupeKey: 'canonical:isbn:9780306406157',
			fallbackUsed: true,
			atom: {
				schemaType: 'Book',
				category: 'thing',
				title: 'Book (ISBN 9780306406157)',
				description: undefined,
				canonicalId: 'isbn:9780306406157',
				sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				source: 'isbn-resolver',
				data: {
					'@context': 'https://schema.org/',
					'@type': 'Book',
					name: 'Book (ISBN 9780306406157)',
					isbn: '9780306406157',
					sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				},
				metadata: {
					pluginId: 'isbn',
					provider: 'isbn',
					fetchedAt: SNAPSHOT_TIME,
					sourceUrl: 'https://www.worldcat.org/isbn/9780306406157',
					identifierType: 'isbn-13',
				},
			},
		},
		provenance: {
			'/classification': {
				source: 'server',
				confidence: 0.98,
				updatedAt: SNAPSHOT_TIME,
				tier: 0,
			},
		},
		debug: {
			inputPreview: INPUT,
			hasClientHints: false,
			inputIntent: 'generic',
			requestedPluginIds: [],
			requestedServerTiers: [],
		},
	},
	progressive: {
		ok: true,
		status: 'complete',
		contractVersion: 'cpkg-02',
		runtime: 'server',
		mode: 'progressive',
		classificationSessionId: 'snapshot-progressive',
		policy: {
			runClientClassification: true,
			runServerEnrichment: true,
			runDedupe: true,
			runAiFallback: false,
			includeProvenance: true,
			requestedServerTiers: [2, 3],
		},
		message: 'Resolved by isbn-resolver with 1 candidate atom.',
		receivedAt: SNAPSHOT_TIME,
		classification: {
			type: 'identifier',
			domain: 'isbn',
			subtype: 'isbn-13',
			confidence: 0.98,
			meta: {
				normalizedIsbn: '9780306406157',
				identifierType: 'ISBN13',
			},
		},
		resolved: {
			resolverId: 'isbn-resolver',
			resolverChain: ['isbn-resolver'],
			dedupeKey: 'canonical:isbn:9780306406157',
			fallbackUsed: true,
			atom: {
				schemaType: 'Book',
				category: 'thing',
				title: 'Book (ISBN 9780306406157)',
				description: undefined,
				canonicalId: 'isbn:9780306406157',
				sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				source: 'isbn-resolver',
				data: {
					'@context': 'https://schema.org/',
					'@type': 'Book',
					name: 'Book (ISBN 9780306406157)',
					isbn: '9780306406157',
					sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				},
				metadata: {
					pluginId: 'isbn',
					provider: 'isbn',
					fetchedAt: SNAPSHOT_TIME,
					sourceUrl: 'https://www.worldcat.org/isbn/9780306406157',
					identifierType: 'isbn-13',
				},
			},
		},
		provenance: {
			'/classification': {
				source: 'server',
				confidence: 0.98,
				updatedAt: SNAPSHOT_TIME,
				tier: 0,
			},
		},
		debug: {
			inputPreview: INPUT,
			hasClientHints: false,
			inputIntent: 'generic',
			requestedPluginIds: [],
			requestedServerTiers: [2, 3],
		},
	},
	'server-only': {
		ok: true,
		status: 'complete',
		contractVersion: 'cpkg-02',
		runtime: 'server',
		mode: 'server-only',
		classificationSessionId: 'snapshot-server-only',
		policy: {
			runClientClassification: false,
			runServerEnrichment: true,
			runDedupe: true,
			runAiFallback: false,
			includeProvenance: true,
			requestedServerTiers: [2, 3],
		},
		message: 'Resolved by isbn-resolver with 1 candidate atom.',
		receivedAt: SNAPSHOT_TIME,
		classification: {
			type: 'identifier',
			domain: 'isbn',
			subtype: 'isbn-13',
			confidence: 0.98,
			meta: {
				normalizedIsbn: '9780306406157',
				identifierType: 'ISBN13',
			},
		},
		resolved: {
			resolverId: 'isbn-resolver',
			resolverChain: ['isbn-resolver'],
			dedupeKey: 'canonical:isbn:9780306406157',
			fallbackUsed: true,
			atom: {
				schemaType: 'Book',
				category: 'thing',
				title: 'Book (ISBN 9780306406157)',
				description: undefined,
				canonicalId: 'isbn:9780306406157',
				sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				source: 'isbn-resolver',
				data: {
					'@context': 'https://schema.org/',
					'@type': 'Book',
					name: 'Book (ISBN 9780306406157)',
					isbn: '9780306406157',
					sameAs: ['https://www.worldcat.org/isbn/9780306406157'],
				},
				metadata: {
					pluginId: 'isbn',
					provider: 'isbn',
					fetchedAt: SNAPSHOT_TIME,
					sourceUrl: 'https://www.worldcat.org/isbn/9780306406157',
					identifierType: 'isbn-13',
				},
			},
		},
		provenance: {
			'/classification': {
				source: 'server',
				confidence: 0.98,
				updatedAt: SNAPSHOT_TIME,
				tier: 0,
			},
		},
		debug: {
			inputPreview: INPUT,
			hasClientHints: false,
			inputIntent: 'generic',
			requestedPluginIds: [],
			requestedServerTiers: [2, 3],
		},
	},
};
