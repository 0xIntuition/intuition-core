import type { AtomClassificationPlugin, ResolverAtom } from './plugins';
import { TYPE_PROFILES_PLUGIN_ID } from './plugins/shared/constants';
import type { ClassificationClientClassificationHint, ClassificationEntityCategory } from './types';

export type AiClassificationSuggestion = {
	schemaType: string;
	category: ClassificationEntityCategory;
	title: string;
	description?: string;
	canonicalId?: string;
	sameAs?: string[];
	confidence: number;
	rationale?: string;
	data?: Record<string, unknown>;
};

export type AiPluginAdapter = {
	classify: (input: {
		value: string;
		classification: ClassificationClientClassificationHint;
	}) => Promise<AiClassificationSuggestion | null>;
};

export type OptionalAiFallbackPluginOptions = {
	enabled?: boolean;
	minConfidenceThreshold?: number;
	adapter?: AiPluginAdapter;
};

export function createOptionalAiFallbackPlugin(
	options: OptionalAiFallbackPluginOptions = {}
): AtomClassificationPlugin {
	const enabled = options.enabled === true && !!options.adapter;
	const minConfidenceThreshold = clampConfidence(options.minConfidenceThreshold ?? 0.7);

	return {
		manifest: {
			id: 'optional-ai-fallback',
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'server',
			capabilities: ['resolve:ai:fallback'],
			permissions: ['ai'],
			dependsOn: [TYPE_PROFILES_PLUGIN_ID],
			provides: ['ai:fallback'],
			priority: 200,
		},
		resolvers: [
			{
				id: 'ai-fallback-resolver',
				priority: 200,
				executionMode: 'server-enrichment',
				canResolve: (classification) => {
					if (!enabled) {
						return false;
					}

					return classification.confidence < minConfidenceThreshold;
				},
				resolve: async ({ request, classification }) => {
					if (!enabled || !options.adapter) {
						return null;
					}

					const suggestion = await options.adapter.classify({
						value: request.input,
						classification,
					});
					if (!suggestion) {
						return null;
					}

					const atom: ResolverAtom = {
						schemaType: suggestion.schemaType,
						category: suggestion.category,
						title: suggestion.title,
						description: suggestion.description,
						canonicalId: suggestion.canonicalId,
						sameAs: suggestion.sameAs,
						source: 'optional-ai-fallback',
						data: {
							...(suggestion.data ?? {}),
						},
						metadata: {
							confidence: suggestion.confidence,
							rationale: suggestion.rationale,
						},
					};

					return {
						atoms: [atom],
						fallbackUsed: false,
						metadata: {
							aiFallback: {
								confidence: suggestion.confidence,
								enabled: true,
							},
						},
					};
				},
			},
		],
	};
}

function clampConfidence(value: number): number {
	if (Number.isNaN(value)) {
		return 0.7;
	}

	if (value < 0) {
		return 0;
	}

	if (value > 1) {
		return 1;
	}

	return value;
}
