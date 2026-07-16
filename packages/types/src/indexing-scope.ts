import { z } from 'zod/v4';

export const multiVaultEventSchema = z.enum([
	'AtomCreated',
	'TripleCreated',
	'Deposited',
	'Redeemed',
	'SharePriceChanged',
	'ProtocolFeeAccrued',
]);

export const indexingScopePresetSchema = z.enum([
	'full',
	'kg-only',
	'market-only',
	'no-analytics',
	'music',
	'podcasts',
	'music-and-podcasts',
]);

export const projectionNameSchema = z.enum([
	'event_log',
	'account_registry',
	'vault_holders_index',
	'signals_analytics',
	'term_aggregates',
	'protocol_stats',
	'activity_marker',
	'leaderboard_marker',
	'vault_state',
	'position_tracking',
	'vault_state:dual',
	'vault_holders_index:dual',
	'leaderboard_refresh',
	'funnel_tracker',
	'user_activity_batch',
	'core_entities',
]);

export const processingClassificationSchema = z.enum(['music', 'podcast']);

export const providerScopeSchema = z.enum([
	'opengraph',
	'jsonld',
	'spotify',
	'podcast-index',
	'wikipedia',
	'wikidata',
	'musicbrainz',
	'apple-music',
]);

export const indexingScopeConfigSchema = z
	.object({
		scope: z.object({
			preset: indexingScopePresetSchema.default('full'),
			ingestion: z.object({
				chain_id: z.number().int().positive(),
				rpc_url: z.string().url(),
				contract: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'must be an EVM address'),
				start_block: z.number().int().nonnegative(),
				end_block: z.number().int().nonnegative().optional(),
				events: z
					.object({
						include: z.array(multiVaultEventSchema).min(1).optional(),
						exclude: z.array(multiVaultEventSchema).default([]),
					})
					.default({ exclude: [] }),
			}),
			projections: z
				.object({
					bundle: indexingScopePresetSchema.optional(),
					include: z.array(projectionNameSchema).optional(),
					exclude: z.array(projectionNameSchema).default([]),
				})
				.default({ exclude: [] }),
			processing: z
				.object({
					classifications: z
						.object({
							include: z.array(processingClassificationSchema).default([]),
						})
						.default({ include: [] }),
					providers: z
						.object({
							include: z.array(providerScopeSchema).default([]),
							require_keys: z.boolean().default(false),
						})
						.default({ include: [], require_keys: false }),
				})
				.default({
					classifications: { include: [] },
					providers: { include: [], require_keys: false },
				}),
		}),
	})
	.superRefine((config, ctx) => {
		const { end_block, events, start_block } = config.scope.ingestion;
		if (end_block !== undefined && end_block < start_block) {
			ctx.addIssue({
				code: 'custom',
				message: 'end_block must be greater than or equal to start_block',
				path: ['scope', 'ingestion', 'end_block'],
			});
		}

		const include = events.include ?? eventsForPreset(config.scope.preset);
		const overlap = events.exclude.filter((event) => include.includes(event));
		if (overlap.length > 0) {
			ctx.addIssue({
				code: 'custom',
				message: `events cannot be both included and excluded: ${overlap.join(', ')}`,
				path: ['scope', 'ingestion', 'events'],
			});
		}

		const effectiveEvents = applyEventExclusions(include, events.exclude);
		if (effectiveEvents.length === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'events include/exclude must resolve to at least one event',
				path: ['scope', 'ingestion', 'events'],
			});
		}
	});

export type MultiVaultEvent = z.infer<typeof multiVaultEventSchema>;
export type IndexingScopePreset = z.infer<typeof indexingScopePresetSchema>;
export type ProjectionName = z.infer<typeof projectionNameSchema>;
export type ProcessingClassification = z.infer<typeof processingClassificationSchema>;
export type ProviderScope = z.infer<typeof providerScopeSchema>;
export type IndexingScopeConfig = z.infer<typeof indexingScopeConfigSchema>;

export type IndexingScopeDryRun = {
	preset: IndexingScopePreset;
	rindexer: {
		network: {
			name: 'intuition';
			chainId: number;
			rpcUrl: string;
		};
		contract: {
			name: 'MultiVault';
			address: string;
			startBlock: number;
			endBlock?: number;
		};
		includeEvents: MultiVaultEvent[];
		env: {
			CHAIN_ID: string;
			INTUITION_RPC_URL: string;
			MULTIVAULT_CONTRACT_ADDRESS: string;
			MULTIVAULT_START_BLOCK: string;
			MULTIVAULT_END_BLOCK?: string;
		};
	};
	projections: {
		bundle: IndexingScopePreset;
		include: ProjectionName[];
		exclude: ProjectionName[];
	};
	processing: {
		classifications: ProcessingClassification[];
		providers: ProviderScope[];
		requireKeys: boolean;
		rindexerBoundary: 'processing-scope-only';
		note: string;
	};
	warnings: string[];
};

const ALL_EVENTS = multiVaultEventSchema.options;

const PRESET_EVENTS = {
	full: ALL_EVENTS,
	'kg-only': ['AtomCreated', 'TripleCreated'],
	'market-only': ['Deposited', 'Redeemed', 'SharePriceChanged', 'ProtocolFeeAccrued'],
	'no-analytics': ALL_EVENTS,
	music: ['AtomCreated', 'TripleCreated'],
	podcasts: ['AtomCreated', 'TripleCreated'],
	'music-and-podcasts': ['AtomCreated', 'TripleCreated'],
} as const satisfies Record<IndexingScopePreset, readonly MultiVaultEvent[]>;

const PRESET_PROJECTIONS = {
	full: [
		'event_log',
		'account_registry',
		'vault_holders_index',
		'signals_analytics',
		'term_aggregates',
		'protocol_stats',
		'activity_marker',
		'leaderboard_marker',
		'vault_state',
		'position_tracking',
		'leaderboard_refresh',
		'funnel_tracker',
		'user_activity_batch',
		'core_entities',
	],
	'kg-only': ['event_log', 'account_registry', 'activity_marker', 'core_entities'],
	'market-only': [
		'event_log',
		'account_registry',
		'vault_holders_index',
		'term_aggregates',
		'protocol_stats',
		'vault_state',
		'position_tracking',
	],
	'no-analytics': [
		'event_log',
		'account_registry',
		'vault_holders_index',
		'term_aggregates',
		'protocol_stats',
		'activity_marker',
		'vault_state',
		'position_tracking',
		'core_entities',
	],
	music: ['event_log', 'account_registry', 'activity_marker', 'core_entities'],
	podcasts: ['event_log', 'account_registry', 'activity_marker', 'core_entities'],
	'music-and-podcasts': ['event_log', 'account_registry', 'activity_marker', 'core_entities'],
} as const satisfies Record<IndexingScopePreset, readonly ProjectionName[]>;

const PRESET_PROCESSING_CLASSIFICATIONS = {
	full: [],
	'kg-only': [],
	'market-only': [],
	'no-analytics': [],
	music: ['music'],
	podcasts: ['podcast'],
	'music-and-podcasts': ['music', 'podcast'],
} as const satisfies Record<IndexingScopePreset, readonly ProcessingClassification[]>;

export function parseIndexingScopeConfig(input: unknown): IndexingScopeConfig {
	return indexingScopeConfigSchema.parse(input);
}

export function safeParseIndexingScopeConfig(input: unknown) {
	return indexingScopeConfigSchema.safeParse(input);
}

export function buildIndexingScopeDryRun(input: unknown): IndexingScopeDryRun {
	const config = parseIndexingScopeConfig(input);
	const { ingestion, preset, processing, projections } = config.scope;
	const includeEvents = resolveEvents(config);
	const projectionBundle = projections.bundle ?? preset;
	const projectionInclude = projections.include ?? [...PRESET_PROJECTIONS[projectionBundle]];
	const processingClassifications =
		processing.classifications.include.length > 0
			? processing.classifications.include
			: [...PRESET_PROCESSING_CLASSIFICATIONS[preset]];
	const rpcUrlForOutput = redactSensitiveUrlForDryRun(ingestion.rpc_url);
	const warnings = buildWarnings({
		includeEvents,
		processingClassifications,
		preset,
		projectionBundle,
		rpcUrlWasRedacted: rpcUrlForOutput.wasRedacted,
	});

	return {
		preset,
		rindexer: {
			network: {
				name: 'intuition',
				chainId: ingestion.chain_id,
				rpcUrl: rpcUrlForOutput.value,
			},
			contract: {
				name: 'MultiVault',
				address: ingestion.contract,
				startBlock: ingestion.start_block,
				...(ingestion.end_block === undefined ? {} : { endBlock: ingestion.end_block }),
			},
			includeEvents,
			env: {
				CHAIN_ID: String(ingestion.chain_id),
				INTUITION_RPC_URL: rpcUrlForOutput.value,
				MULTIVAULT_CONTRACT_ADDRESS: ingestion.contract,
				MULTIVAULT_START_BLOCK: String(ingestion.start_block),
				...(ingestion.end_block === undefined
					? {}
					: { MULTIVAULT_END_BLOCK: String(ingestion.end_block) }),
			},
		},
		projections: {
			bundle: projectionBundle,
			include: projectionInclude.filter((projection) => !projections.exclude.includes(projection)),
			exclude: projections.exclude,
		},
		processing: {
			classifications: processingClassifications,
			providers: processing.providers.include,
			requireKeys: processing.providers.require_keys,
			rindexerBoundary: 'processing-scope-only',
			note: 'Classification and provider filters are processing-scope controls. They are not rindexer hard filters and do not remove chain events from ingestion.',
		},
		warnings,
	};
}

export function renderRindexerManifestPreview(dryRun: IndexingScopeDryRun): string {
	const endBlockLine =
		dryRun.rindexer.contract.endBlock === undefined
			? ''
			: `        end_block: ${dryRun.rindexer.contract.endBlock}\n`;
	const eventLines = dryRun.rindexer.includeEvents
		.map((event) => `      - name: ${event}`)
		.join('\n');

	return `name: be_v3_indexer
networks:
  - name: intuition
    chain_id: ${dryRun.rindexer.network.chainId}
    rpc: "${dryRun.rindexer.network.rpcUrl}"
contracts:
  - name: MultiVault
    details:
      - network: intuition
        address: "${dryRun.rindexer.contract.address}"
        start_block: ${dryRun.rindexer.contract.startBlock}
${endBlockLine}        reorg_safe_distance: 10
    include_events:
${eventLines}
`;
}

function resolveEvents(config: IndexingScopeConfig): MultiVaultEvent[] {
	const { events } = config.scope.ingestion;
	const include = events.include ?? eventsForPreset(config.scope.preset);
	return applyEventExclusions(include, events.exclude);
}

function eventsForPreset(preset: IndexingScopePreset): MultiVaultEvent[] {
	return [...PRESET_EVENTS[preset]];
}

function applyEventExclusions(
	include: readonly MultiVaultEvent[],
	exclude: readonly MultiVaultEvent[]
): MultiVaultEvent[] {
	const excluded = new Set(exclude);
	return include.filter((event) => !excluded.has(event));
}

function buildWarnings(input: {
	includeEvents: MultiVaultEvent[];
	preset: IndexingScopePreset;
	processingClassifications: ProcessingClassification[];
	projectionBundle: IndexingScopePreset;
	rpcUrlWasRedacted: boolean;
}): string[] {
	const warnings: string[] = [];

	if (input.rpcUrlWasRedacted) {
		warnings.push(
			'RPC URL credentials or token-like query parameters were redacted from dry-run output.'
		);
	}

	if (input.processingClassifications.length > 0) {
		warnings.push(
			'Domain filters are processing-scope only. rindexer will still ingest the configured chain events.'
		);
	}

	if (
		input.projectionBundle === 'market-only' &&
		input.includeEvents.some((event) => event === 'AtomCreated' || event === 'TripleCreated')
	) {
		warnings.push(
			'market-only projection scope includes identity events only if explicitly configured.'
		);
	}

	if (input.preset === 'kg-only' && input.includeEvents.length < PRESET_EVENTS['kg-only'].length) {
		warnings.push('kg-only scopes need AtomCreated and TripleCreated for complete graph identity.');
	}

	return warnings;
}

function redactSensitiveUrlForDryRun(rawUrl: string): { value: string; wasRedacted: boolean } {
	const sensitiveParamPattern =
		/(^|[-_])(api[-_]?key|auth|bearer|key|password|secret|sig|signature|token)([-_]|$)/i;

	try {
		const url = new URL(rawUrl);
		let wasRedacted = false;

		if (url.username.length > 0) {
			url.username = 'REDACTED';
			wasRedacted = true;
		}

		if (url.password.length > 0) {
			url.password = 'REDACTED';
			wasRedacted = true;
		}

		for (const key of [...url.searchParams.keys()]) {
			if (sensitiveParamPattern.test(key)) {
				url.searchParams.set(key, 'REDACTED');
				wasRedacted = true;
			}
		}

		return {
			value: wasRedacted ? url.toString() : rawUrl,
			wasRedacted,
		};
	} catch {
		return { value: rawUrl, wasRedacted: false };
	}
}
