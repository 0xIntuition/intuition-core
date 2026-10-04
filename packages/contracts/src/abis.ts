/**
 * Single import point for protocol ABIs across the monorepo.
 *
 * Everything re-exported here comes from the pinned `@0xintuition/contracts-v2`
 * package (typed `as const`, viem-ready). AtomWarden and WrappedTrust remain
 * surfaced from the regenerated vendored pins until their consumers migrate
 * to the equivalent 1.1 package exports; see `../vendored/README.md`.
 */
export {
	AtomWalletAbi,
	AtomWalletFactoryAbi,
	BaseEmissionsControllerAbi,
	BondingCurveRegistryAbi,
	LinearCurveAbi,
	MultiVaultAbi,
	MultiVaultMigrationModeAbi,
	OffsetProgressiveCurveAbi,
	SatelliteEmissionsControllerAbi,
	TrustAbi,
	TrustBondingAbi,
	TrustTokenAbi,
} from '@0xintuition/contracts-v2/abis';

export { AtomWardenAbi, WrappedTrustAbi } from './vendored';
