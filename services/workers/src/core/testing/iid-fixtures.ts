import type { IidInspection } from '@0xintuition/iid';
import type { IidClassification } from '@0xintuition/iid-registry';
import type { IidInspectionAdapter } from '../iid-inspection';
import { type IidLadderAdapter, projectIdentityRungs } from '../iid-ladder';
import { type IidRegistryAdapter, resolveIidAlias, resolveIidIdentity } from '../iid-registry';

export function inspectionFixture(input: {
	inspectIntuitionId: (value: string) => IidInspection;
	packageVersion: string;
	specificationVersion?: string;
}): IidInspectionAdapter {
	return {
		inspect: input.inspectIntuitionId,
		provenance: {
			producer: '@0xintuition/iid/inspectIntuitionId',
			version: input.packageVersion,
			...(input.specificationVersion ? { specificationVersion: input.specificationVersion } : {}),
		},
	};
}

export function registryFixture(input: {
	classificationForIid: (iid: string) => IidClassification | undefined;
	providersForIid: (iid: string) => readonly string[];
	identifierHintsForIid: (iid: string) => Record<string, string>;
	packageVersion: string;
	inspect?: (iid: string) => unknown;
}): IidRegistryAdapter {
	const calls = input as Parameters<typeof resolveIidIdentity>[1];
	return {
		resolve: (identity) => resolveIidIdentity(identity, calls, input.packageVersion),
		...(input.inspect
			? {
					resolveAlias: (iid: string) =>
						resolveIidAlias(iid, calls, input.inspect as IidInspectionAdapter['inspect'], {
							producer: '@0xintuition/iid-registry/providersForIid+identifierHintsForIid',
							version: input.packageVersion,
						}),
				}
			: {}),
	};
}

export function ladderFixture(
	module: {
		packageVersion: string;
		isPlainWdPrimaryAllowed: IidLadderAdapter['isPlainWdPrimaryAllowed'];
		resolveWikidataP31Identity?: (p31: readonly string[]) => { schemaType: string };
		[key: string]: unknown;
	},
	inspection: Pick<IidInspectionAdapter, 'inspect'>
): IidLadderAdapter {
	return {
		projectIdentityRungs: (input) =>
			projectIdentityRungs(
				input,
				module as unknown as Parameters<typeof projectIdentityRungs>[1],
				inspection,
				module.packageVersion
			),
		isPlainWdPrimaryAllowed: module.isPlainWdPrimaryAllowed,
		...(module.resolveWikidataP31Identity
			? {
					resolveWikidataSchemaType: (p31: string[]) => {
						const schemaType = module.resolveWikidataP31Identity!(p31).schemaType;
						return schemaType === 'Thing' ? undefined : schemaType;
					},
					wikidataTypeProvenance: {
						producer: '@0xintuition/iid-ladder/resolveWikidataP31Identity',
						version: module.packageVersion,
					},
				}
			: {}),
	};
}
