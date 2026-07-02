import { z } from 'zod/v4';

export const etherscanBalanceResponseSchema = z
	.object({
		status: z.string().optional(),
		message: z.string().optional(),
		result: z.string().optional(),
	})
	.passthrough();

export const etherscanTxCountResponseSchema = z
	.object({
		result: z.string().optional(),
	})
	.passthrough();

export const etherscanContractMetadataResponseSchema = z
	.object({
		ContractName: z.string().optional(),
		ABI: z.string().optional(),
		TokenName: z.string().optional(),
		TokenSymbol: z.string().optional(),
	})
	.passthrough();

export const etherscanContractResponseSchema = z
	.object({
		status: z.string().optional(),
		message: z.string().optional(),
		result: z.array(etherscanContractMetadataResponseSchema).optional(),
	})
	.passthrough();

export type EtherscanBalanceResponse = z.infer<typeof etherscanBalanceResponseSchema>;
export type EtherscanTxCountResponse = z.infer<typeof etherscanTxCountResponseSchema>;
export type EtherscanContractMetadataResponse = z.infer<
	typeof etherscanContractMetadataResponseSchema
>;
export type EtherscanContractResponse = z.infer<typeof etherscanContractResponseSchema>;
