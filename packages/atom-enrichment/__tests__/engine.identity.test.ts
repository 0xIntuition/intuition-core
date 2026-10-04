import { expect, test } from 'bun:test';
import { createEnrichmentEngine } from '../src/engine';
import type { EnrichmentIdentityCapability, EnrichmentPluginContext } from '../src/plugins';
import { createMockPlugin, createMockRequest } from '../src/testing';

test('identity is injected per engine and the absent context keeps its original shape', async () => {
	const identity: EnrichmentIdentityCapability = {
		fingerprint: 'test-policy@1',
		resolveWikidataSchemaType: () => 'Movie',
	};
	const contexts: EnrichmentPluginContext[] = [];
	const plugin = createMockPlugin({
		enrich: async (_request, ctx) => {
			contexts.push(ctx);
			return [];
		},
	});
	const configured = createEnrichmentEngine({ plugins: [plugin], identity });
	const absent = createEnrichmentEngine({ plugins: [plugin] });
	await configured.enrich(createMockRequest());
	await absent.enrich(createMockRequest());
	await configured.enrich(createMockRequest());
	expect(contexts).toHaveLength(3);
	expect(contexts[0]?.identity).toBe(identity);
	expect(contexts[1]?.identity).toBeUndefined();
	expect(Object.hasOwn(contexts[1] ?? {}, 'identity')).toBe(false);
	expect(contexts[2]?.identity).toBe(identity);
});
