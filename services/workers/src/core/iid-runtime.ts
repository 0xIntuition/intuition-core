import { WorkerConfigurationError } from '../shared/errors';
import {
	createIidInspectionAdapter,
	type IidInspectionAdapter,
	type PublicIidInspection,
} from './iid-inspection';
import {
	createIidRegistryAdapter,
	type IidRegistryAdapter,
	type PublicIidClassification,
} from './iid-registry';

const EXACT_SEMVER =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export type PublicIidRuntimeModule = {
	inspectIntuitionId(rawInput: string): PublicIidInspection;
};

export type PublicIidRegistryRuntimeModule = {
	classificationForIid(iid: string): PublicIidClassification | undefined;
	providersForIid(iid: string): readonly string[];
	identifierHintsForIid(iid: string): Record<string, string>;
};

export type PublicPackageManifest = {
	name: string;
	version: string;
};

export type IidWorkerAdapters = {
	iidInspection: IidInspectionAdapter;
	iidRegistry: IidRegistryAdapter;
};

/**
 * Production composition boundary for the two public IID packages.
 *
 * The caller must statically import these modules from exact, lockfile-backed
 * package dependencies. This factory intentionally does not resolve arbitrary
 * paths, URLs, NODE_PATH entries, or package names at runtime: those mechanisms
 * would bypass Core's minimum-release-age and deterministic-install policy.
 */
export function composeIidWorkerAdapters(input: {
	iid: PublicIidRuntimeModule;
	iidManifest: PublicPackageManifest;
	iidRegistry: PublicIidRegistryRuntimeModule;
	iidRegistryManifest: PublicPackageManifest;
	iidSpecificationVersion: string;
}): IidWorkerAdapters {
	assertPackageManifest(input.iidManifest, '@0xintuition/iid');
	assertPackageManifest(input.iidRegistryManifest, '@0xintuition/iid-registry');

	return {
		iidInspection: createIidInspectionAdapter({
			inspectIntuitionId: input.iid.inspectIntuitionId,
			packageVersion: input.iidManifest.version,
			specificationVersion: requireExactVersion(
				input.iidSpecificationVersion,
				'@0xintuition/iid-spec',
				'@0xintuition/iid-spec@'
			),
		}),
		iidRegistry: createIidRegistryAdapter({
			classificationForIid: input.iidRegistry.classificationForIid,
			providersForIid: input.iidRegistry.providersForIid,
			identifierHintsForIid: input.iidRegistry.identifierHintsForIid,
			packageVersion: input.iidRegistryManifest.version,
		}),
	};
}

function assertPackageManifest(manifest: PublicPackageManifest, expectedName: string): void {
	if (manifest.name !== expectedName) {
		throw new WorkerConfigurationError(
			`Expected ${expectedName} package manifest, received ${manifest.name || '<empty>'}.`
		);
	}
	requireExactVersion(manifest.version, expectedName);
}

function requireExactVersion(value: string, packageName: string, prefix = ''): string {
	const version = value.trim();
	const semver = prefix ? version.slice(prefix.length) : version;
	if ((prefix && !version.startsWith(prefix)) || !EXACT_SEMVER.test(semver)) {
		throw new WorkerConfigurationError(
			`${packageName} runtime composition requires an exact installed version.`
		);
	}
	return version;
}
