import { toStringMaybe } from '../shared/helpers';
import {
	type AmazonDomainApiAdapterOptions,
	createAmazonDomainApiAdapter,
} from './domain-api-adapter';
import type { AmazonPluginOptions } from './index';

export type AmazonCanopyPluginOptionsInput = Pick<AmazonDomainApiAdapterOptions, 'fetch'> & {
	apiKey?: string;
};

export function createAmazonCanopyPluginOptions(
	input: AmazonCanopyPluginOptionsInput = {}
): AmazonPluginOptions | undefined {
	const apiKey = toStringMaybe(input.apiKey);
	if (!apiKey && !input.fetch) {
		return undefined;
	}

	return {
		credentials: {
			amazon: {
				...(apiKey ? { apiKey } : {}),
			},
		},
		adapters: {
			domainApi: createAmazonDomainApiAdapter({
				apiKey,
				fetch: input.fetch,
			}),
		},
	};
}
