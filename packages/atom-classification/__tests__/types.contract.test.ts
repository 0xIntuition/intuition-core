import { describe, expect, it } from 'bun:test';

import {
	classificationFieldProvenanceMapSchema,
	classificationRequestSchema,
	getDefaultEnhancementPolicy,
	resolveEnhancementPolicy,
} from '../src/types';

describe('classification mode/config/hint contract', () => {
	it('applies progressive defaults when policy overrides are omitted', () => {
		const request = classificationRequestSchema.parse({
			input: 'https://example.com',
		});
		const policy = resolveEnhancementPolicy(request.mode, request.policy);

		expect(request.mode).toBe('progressive');
		expect(policy).toEqual(getDefaultEnhancementPolicy('progressive'));
	});

	it('rejects incompatible client-only policy overrides', () => {
		expect(() =>
			classificationRequestSchema.parse({
				input: 'hello world',
				mode: 'client-only',
				policy: {
					runServerEnrichment: true,
					requestedServerTiers: [2],
				},
			})
		).toThrow();
	});

	it('rejects incompatible server-only policy overrides', () => {
		expect(() =>
			classificationRequestSchema.parse({
				input: 'hello world',
				mode: 'server-only',
				policy: {
					runClientClassification: true,
				},
			})
		).toThrow();
	});

	it('accepts structured client hints contract', () => {
		const request = classificationRequestSchema.parse({
			input: 'https://open.spotify.com/track/123',
			mode: 'progressive',
			classificationSessionId: 'session-123',
			pluginIds: ['spotify', 'type-profiles'],
			clientHints: {
				platform: 'web',
				locale: 'en-US',
				expectedTypes: ['MusicRecording'],
				clientClassification: {
					type: 'url',
					domain: 'spotify',
					subtype: 'track',
					confidence: 0.95,
					meta: {
						resourceId: '123',
					},
				},
			},
		});

		expect(request.clientHints?.clientClassification?.domain).toBe('spotify');
		expect(request.clientHints?.clientClassification?.confidence).toBe(0.95);
		expect(request.pluginIds).toEqual(['spotify', 'type-profiles']);
	});

	it('rejects malformed plugin ids early', () => {
		expect(() =>
			classificationRequestSchema.parse({
				input: 'https://example.com',
				pluginIds: ['Bad Plugin'],
			})
		).toThrow();
	});

	it('validates field-level provenance contract', () => {
		const provenance = classificationFieldProvenanceMapSchema.parse({
			'/name': {
				source: 'merged',
				confidence: 0.9,
				updatedAt: new Date().toISOString(),
				tier: 2,
				resolverId: 'spotify',
			},
		});

		expect(provenance['/name']?.source).toBe('merged');
		expect(provenance['/name']?.tier).toBe(2);
	});
});
