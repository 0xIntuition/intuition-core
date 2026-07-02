import { z } from 'zod/v4';

export const coinGeckoImageResponseSchema = z
	.object({
		thumb: z.string().optional(),
		small: z.string().optional(),
		large: z.string().optional(),
	})
	.passthrough();

export const coinGeckoLinksResponseSchema = z
	.object({
		homepage: z.array(z.string()).optional(),
	})
	.passthrough();

export const coinGeckoMarketValueResponseSchema = z
	.object({
		usd: z.number().nullable().optional(),
	})
	.passthrough();

export const coinGeckoMarketDataResponseSchema = z
	.object({
		current_price: coinGeckoMarketValueResponseSchema.optional(),
		market_cap: coinGeckoMarketValueResponseSchema.optional(),
		total_supply: z.number().nullable().optional(),
	})
	.passthrough();

export const coinGeckoPlatformDetailResponseSchema = z
	.object({
		decimal_place: z.number().nullable().optional(),
		contract_address: z.string().nullable().optional(),
	})
	.passthrough();

export const coinGeckoResponseSchema = z
	.object({
		id: z.string().optional(),
		symbol: z.string().optional(),
		name: z.string().optional(),
		image: coinGeckoImageResponseSchema.optional(),
		links: coinGeckoLinksResponseSchema.optional(),
		market_data: coinGeckoMarketDataResponseSchema.optional(),
		detail_platforms: z
			.record(z.string(), coinGeckoPlatformDetailResponseSchema.nullable())
			.optional(),
	})
	.passthrough();

export type CoinGeckoResponse = z.infer<typeof coinGeckoResponseSchema>;
