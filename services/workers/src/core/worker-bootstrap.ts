import iidManifest from '@0xintuition/iid/package.json';
import ladderManifest from '@0xintuition/iid-ladder/package.json';
import registryManifest from '@0xintuition/iid-registry/package.json';
import workerManifest from '../../package.json';
import { WorkerConfigurationError } from '../shared/errors';
import { iidInspection } from './iid-inspection';
import { iidLadder } from './iid-ladder';
import { iidRegistry } from './iid-registry';

const installedManifests = [iidManifest, registryManifest, ladderManifest];
const pinnedVersions = {
	'@0xintuition/iid': workerManifest.dependencies['@0xintuition/iid'],
	'@0xintuition/iid-registry': workerManifest.dependencies['@0xintuition/iid-registry'],
	'@0xintuition/iid-ladder': workerManifest.dependencies['@0xintuition/iid-ladder'],
};

export function assertIidPackageVersions(
	manifests: readonly { name: string; version: string }[] = installedManifests
): void {
	for (const [name, version] of Object.entries(pinnedVersions)) {
		const matches = manifests.filter((manifest) => manifest.name === name);
		if (matches.length !== 1 || matches[0]?.version !== version) {
			throw new WorkerConfigurationError(
				`${name} requires the pinned installed version ${version}.`
			);
		}
	}
}

/**
 * Bind the statically imported packages before opening the worker's lifecycle server.
 * The exact-version check guards the IID read path only: with the flag off, the legacy
 * path never touches these packages, so an installed-version drift must not stop a
 * node operator who never enabled IID reads.
 */
export function createWorkerIdentityRuntime(
	iidReadEnabled: boolean,
	manifests: readonly { name: string; version: string }[] = installedManifests
) {
	if (!iidReadEnabled) {
		return {};
	}
	assertIidPackageVersions(manifests);
	return { iidInspection, iidRegistry, iidLadder };
}
