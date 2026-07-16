import { describe, expect, test } from 'bun:test';
import {
	buildIndexingScopeDryRun,
	renderRindexerManifestPreview,
	safeParseIndexingScopeConfig,
} from './indexing-scope';

const validScopeConfig = {
	scope: {
		preset: 'music-and-podcasts',
		ingestion: {
			chain_id: 13_579,
			rpc_url: 'https://rpc-testnet.intuition.systems',
			contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
			start_block: 9_030_416,
			end_block: 9_030_916,
			events: {
				include: ['AtomCreated', 'TripleCreated'],
				exclude: [],
			},
		},
		projections: {
			bundle: 'kg-only',
			include: ['event_log', 'account_registry', 'core_entities'],
			exclude: [],
		},
		processing: {
			classifications: {
				include: ['music', 'podcast'],
			},
			providers: {
				include: ['opengraph', 'jsonld', 'spotify', 'podcast-index'],
				require_keys: false,
			},
		},
	},
} as const;

describe('IndexingScope schema', () => {
	test('renders rindexer hard filters and marks domain filters as processing scope', () => {
		const dryRun = buildIndexingScopeDryRun(validScopeConfig);

		expect(dryRun.rindexer.env).toEqual({
			CHAIN_ID: '13579',
			INTUITION_RPC_URL: 'https://rpc-testnet.intuition.systems',
			MULTIVAULT_CONTRACT_ADDRESS: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
			MULTIVAULT_START_BLOCK: '9030416',
			MULTIVAULT_END_BLOCK: '9030916',
		});
		expect(dryRun.rindexer.includeEvents).toEqual(['AtomCreated', 'TripleCreated']);
		expect(dryRun.processing.rindexerBoundary).toBe('processing-scope-only');
		expect(dryRun.processing.classifications).toEqual(['music', 'podcast']);
		expect(dryRun.projections.outputs).toContainEqual({
			name: 'core_entities',
			reason: 'selected',
			requiredEvents: ['AtomCreated', 'TripleCreated'],
			status: 'available',
		});
		expect(dryRun.projections.outputs).toContainEqual({
			name: 'vault_state',
			reason: 'not-in-bundle',
			requiredEvents: ['Deposited', 'Redeemed', 'SharePriceChanged'],
			status: 'unavailable',
		});
		expect(dryRun.warnings).toContain(
			'Domain filters are processing-scope only. rindexer will still ingest the configured chain events.'
		);
	});

	test('renders a manifest preview from validated scope config', () => {
		const manifest = renderRindexerManifestPreview(buildIndexingScopeDryRun(validScopeConfig));

		expect(manifest).toContain('chain_id: 13579');
		expect(manifest).toContain('address: "0xeBc49d356B7f64D888130D85CC6D17114a6843ec"');
		expect(manifest).toContain('start_block: 9030416');
		expect(manifest).toContain('end_block: 9030916');
		expect(manifest).toContain('      - name: AtomCreated');
		expect(manifest).toContain('      - name: TripleCreated');
		expect(manifest).not.toContain('Spotify');
		expect(manifest).not.toContain('podcast-index');
	});

	test('uses preset event defaults when include is omitted', () => {
		const dryRun = buildIndexingScopeDryRun({
			scope: {
				preset: 'market-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
				},
			},
		});

		expect(dryRun.rindexer.includeEvents).toEqual([
			'Deposited',
			'Redeemed',
			'SharePriceChanged',
			'ProtocolFeeAccrued',
		]);
		expect(dryRun.rindexer.env).not.toHaveProperty('MULTIVAULT_END_BLOCK');
	});

	test('explains available and unavailable outputs for a valid market bundle', () => {
		const dryRun = buildIndexingScopeDryRun({
			scope: {
				preset: 'market-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
				},
			},
		});

		expect(dryRun.projections.include).toContain('vault_state');
		expect(dryRun.projections.include).toContain('leaderboard_refresh');
		expect(dryRun.projections.include).not.toContain('term_aggregates');
		expect(dryRun.projections.outputs).toContainEqual({
			name: 'vault_state',
			reason: 'selected',
			requiredEvents: ['Deposited', 'Redeemed', 'SharePriceChanged'],
			status: 'available',
		});
		expect(dryRun.projections.outputs).toContainEqual({
			name: 'term_aggregates',
			reason: 'not-in-bundle',
			requiredEvents: ['TripleCreated', 'SharePriceChanged'],
			status: 'unavailable',
		});
	});

	test('rejects market bundles missing required financial events', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				preset: 'market-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
					events: {
						include: ['Deposited', 'Redeemed'],
						exclude: [],
					},
				},
				projections: {
					bundle: 'market-only',
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				'projection bundle "market-only" requires events: Deposited, Redeemed, SharePriceChanged; missing: SharePriceChanged'
			);
		}
	});

	test('rejects explicit market projections when the ingestion scope cannot satisfy them', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				preset: 'kg-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
				},
				projections: {
					include: ['vault_state'],
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				'projection event requirements are not satisfied: vault_state missing Deposited, Redeemed, SharePriceChanged'
			);
		}
	});

	test('rejects protocol stats without graph and fee events', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				preset: 'market-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
				},
				projections: {
					include: ['protocol_stats'],
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				'projection event requirements are not satisfied: protocol_stats missing AtomCreated, TripleCreated'
			);
		}
	});

	test('redacts RPC URL credentials and token-like query parameters in dry-run output', () => {
		const dryRun = buildIndexingScopeDryRun({
			scope: {
				...validScopeConfig.scope,
				ingestion: {
					...validScopeConfig.scope.ingestion,
					rpc_url:
						'https://operator:secret@rpc-testnet.intuition.systems/path?apiKey=abc123&region=us',
				},
			},
		});

		expect(dryRun.rindexer.network.rpcUrl).toBe(
			'https://REDACTED:REDACTED@rpc-testnet.intuition.systems/path?apiKey=REDACTED&region=us'
		);
		expect(dryRun.rindexer.env.INTUITION_RPC_URL).toBe(dryRun.rindexer.network.rpcUrl);
		expect(renderRindexerManifestPreview(dryRun)).toContain(
			'rpc: "https://REDACTED:REDACTED@rpc-testnet.intuition.systems/path?apiKey=REDACTED&region=us"'
		);
		expect(dryRun.warnings).toContain(
			'RPC URL credentials or token-like query parameters were redacted from dry-run output.'
		);
	});

	test('rejects invalid contract addresses before indexing', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				...validScopeConfig.scope,
				ingestion: {
					...validScopeConfig.scope.ingestion,
					contract: '0xabc',
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.path).toEqual(['scope', 'ingestion', 'contract']);
		}
	});

	test('rejects unknown events before indexing', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				...validScopeConfig.scope,
				ingestion: {
					...validScopeConfig.scope.ingestion,
					events: {
						include: ['AtomCreated', 'MadeUpEvent'],
						exclude: [],
					},
				},
			},
		});

		expect(result.success).toBe(false);
	});

	test('rejects block ranges where end precedes start', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				...validScopeConfig.scope,
				ingestion: {
					...validScopeConfig.scope.ingestion,
					start_block: 200,
					end_block: 100,
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'end_block must be greater than or equal to start_block'
			);
		}
	});

	test('rejects event include and exclude overlap', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				...validScopeConfig.scope,
				ingestion: {
					...validScopeConfig.scope.ingestion,
					events: {
						include: ['AtomCreated', 'TripleCreated'],
						exclude: ['AtomCreated'],
					},
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0]?.message).toBe(
				'events cannot be both included and excluded: AtomCreated'
			);
		}
	});

	test('rejects configs whose effective event set is empty after exclusions', () => {
		const result = safeParseIndexingScopeConfig({
			scope: {
				preset: 'kg-only',
				ingestion: {
					chain_id: 13_579,
					rpc_url: 'https://rpc-testnet.intuition.systems',
					contract: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
					start_block: 9_030_416,
					events: {
						exclude: ['AtomCreated', 'TripleCreated'],
					},
				},
			},
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toContain(
				'events include/exclude must resolve to at least one event'
			);
		}
	});
});
