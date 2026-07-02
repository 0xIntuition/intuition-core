/**
 * Timescale Domain Types
 *
 * Shared type definitions for the Timescale time-series data layer.
 * These types are used by both the tRPC layer and API consumers.
 *
 * @module @0xintuition/types/timescale
 */

export const vaultSortOptions = ['holderCount', 'marketCap', 'updatedAt'] as const;

export type VaultSortOption = (typeof vaultSortOptions)[number];

export type ListVaultSummariesInput = {
	limit: number;
	sortBy: VaultSortOption;
};

export type TimescaleVaultSummary = {
	termId: string;
	curveId: string;
	totalShares: string;
	currentSharePrice: string;
	totalAssets: string;
	totalDeposits: string;
	totalRedemptions: string;
	marketCap: string;
	holderCount: number;
	createdAt: string;
	updatedAt: string;
};

export type TimescaleProtocolStats = {
	totalAtoms: string;
	totalTriples: string;
	totalAccounts: string;
	totalDepositsCount: string;
	totalRedemptionsCount: string;
	totalDepositVolume: string;
	totalRedemptionVolume: string;
	totalFees: string;
	updatedAt: string;
};

export interface TimescaleService {
	listVaultSummaries(input: ListVaultSummariesInput): Promise<TimescaleVaultSummary[]>;
	getProtocolStats(): Promise<TimescaleProtocolStats | null>;
}
