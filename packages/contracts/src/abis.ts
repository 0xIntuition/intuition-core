/**
 * Single import point for protocol ABIs across the monorepo.
 *
 * Everything re-exported here comes from the pinned `@0xintuition/contracts-v2`
 * package (typed `as const`, viem-ready). Contracts the package does not yet
 * export (AtomWarden, WrappedTrust) are surfaced from the vendored artifacts —
 * see `../vendored/README.md`.
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
