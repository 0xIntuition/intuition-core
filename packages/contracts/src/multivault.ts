import { MultiVaultBytecode } from '@0xintuition/contracts-v2';
import { MultiVaultAbi } from './abis';

export const MULTIVAULT_CONTRACT_NAME = 'MultiVault' as const;
export const MULTIVAULT_RINDEXER_EVENTS = [
	'AtomCreated',
	'AtomContextRegistered',
	'TripleCreated',
	'Deposited',
	'Redeemed',
	'SharePriceChanged',
	'ProtocolFeeAccrued',
] as const;

export { MultiVaultAbi, MultiVaultBytecode };

export type MultiVaultAbiItem = (typeof MultiVaultAbi)[number];
export type MultiVaultRindexerEvent = (typeof MULTIVAULT_RINDEXER_EVENTS)[number];

export const getMultiVaultAbi = () => MultiVaultAbi;

export const getMultiVaultAbiJson = () => JSON.stringify(MultiVaultAbi, null, '\t');
