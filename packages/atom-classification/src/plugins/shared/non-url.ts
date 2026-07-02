import type {
	AtomClassificationPlugin,
	AtomClassifier,
	ResolverContext,
	ResolverResult,
} from '../../plugins';
import type { ClassificationClientClassificationHint, ClassificationRequest } from '../../types';
import { TYPE_PROFILES_PLUGIN_ID } from './constants';

export type NonUrlV0Profile = {
	id: string;
	classifier: AtomClassifier;
	canResolve: (
		classification: Readonly<ClassificationClientClassificationHint>,
		request: Readonly<ClassificationRequest>
	) => boolean;
	resolve: (
		context: ResolverContext
	) => ResolverResult | Promise<ResolverResult | null | undefined> | null | undefined;
};

export function createNonUrlPlugin(input: {
	pluginId: string;
	resolverId: string;
	profile: NonUrlV0Profile;
}): AtomClassificationPlugin {
	const { pluginId, resolverId, profile } = input;

	return {
		manifest: {
			id: pluginId,
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: [`classify:${profile.id}`, 'resolve:non-url-v0'],
			permissions: [],
			dependsOn: [TYPE_PROFILES_PLUGIN_ID],
			provides: [`non-url:v0:${profile.id}`],
			priority: 10,
		},
		classifiers: [profile.classifier],
		resolvers: [
			{
				id: resolverId,
				priority: 35,
				executionMode: 'deterministic',
				canResolve: (classification, request) => profile.canResolve(classification, request),
				resolve: (context) => profile.resolve(context),
			},
		],
	};
}
