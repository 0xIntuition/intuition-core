import type { EnrichmentPlugin, EnrichmentPluginContext } from '../plugins';
import type { ClassifiedAtomInput, EnrichmentArtifact, EnrichmentRequest } from '../types';

export function createMockAtomInput(
	overrides: Partial<ClassifiedAtomInput> = {}
): ClassifiedAtomInput {
	return {
		atomType: 'thing',
		jsonLd: {
			'@context': 'https://schema.org',
			'@type': 'Thing',
			name: 'Test Entity',
		},
		source: {
			classificationEngine: '@0xintuition/atom-classification',
			classifiedAt: '2026-01-01T00:00:00.000Z',
		},
		hints: {
			name: 'Test Entity',
			url: 'https://example.com',
		},
		...overrides,
	};
}

export function createMockRequest(overrides: Partial<EnrichmentRequest> = {}): EnrichmentRequest {
	return {
		input: createMockAtomInput(overrides.input as Partial<ClassifiedAtomInput>),
		runtime: 'server',
		concurrency: 5,
		timeoutMs: 10_000,
		...overrides,
	};
}

export function createMockPluginContext(
	overrides: Partial<EnrichmentPluginContext> = {}
): EnrichmentPluginContext {
	const controller = new AbortController();

	return {
		now: () => '2026-01-01T00:00:00.000Z',
		signal: controller.signal,
		logger: {
			debug: () => {},
			warn: () => {},
			error: () => {},
		},
		...overrides,
	};
}

export function createMockPlugin(
	overrides: Partial<EnrichmentPlugin> & {
		mockArtifacts?: EnrichmentArtifact[];
		mockSupports?: boolean;
		mockDelay?: number;
		mockError?: Error;
	} = {}
): EnrichmentPlugin {
	const {
		mockArtifacts = [],
		mockSupports = true,
		mockDelay = 0,
		mockError,
		...pluginOverrides
	} = overrides;

	return {
		id: 'mock-plugin',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['opengraph'],
		supports: () => mockSupports,
		enrich: async () => {
			if (mockDelay > 0) {
				await new Promise((resolve) => setTimeout(resolve, mockDelay));
			}
			if (mockError) {
				throw mockError;
			}
			return mockArtifacts;
		},
		...pluginOverrides,
	};
}

export function createMockArtifact(
	overrides: Partial<EnrichmentArtifact> = {}
): EnrichmentArtifact {
	return {
		artifact_type: 'opengraph',
		data: {
			title: 'Test Page',
			description: 'A test page',
			url: 'https://example.com',
		},
		meta: {
			pluginId: 'mock-plugin',
			provider: 'test',
			fetchedAt: '2026-01-01T00:00:00.000Z',
		},
		...overrides,
	};
}
