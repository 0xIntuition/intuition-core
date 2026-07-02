import { z } from 'zod/v4';

export const etherscanDataSchema = z.object({
	address: z.string(),
	balance: z.string(),
	balanceEth: z.string().optional(),
	transactionCount: z.number().optional(),
	isContract: z.boolean(),
	contractName: z.string().optional(),
	tokenName: z.string().optional(),
	tokenSymbol: z.string().optional(),
	firstSeen: z.string().optional(),
});

export type EtherscanData = z.infer<typeof etherscanDataSchema>;
