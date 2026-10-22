import { expect, test } from 'bun:test';
import {
	fetchJson,
	fetchText,
	ProviderHttpError,
} from '../../src/plugins/providers/__shared__/http';

for (const fetchBody of [fetchJson, fetchText]) {
	test(`${fetchBody.name} retains only a credential-free endpoint`, async () => {
		try {
			await fetchBody(
				async () => new Response('', { status: 429 }),
				'https://user:SECRET@api.etherscan.io/api?apikey=SECRET#SECRET'
			);
			throw new Error('Expected HTTP failure');
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderHttpError);
			expect(error).toMatchObject({
				status: 429,
				provider: 'api.etherscan.io',
				url: 'https://api.etherscan.io/api',
			});
			expect(String(error)).not.toContain('SECRET');
			expect(String(error)).not.toContain('?');
			expect(JSON.stringify(error)).not.toContain('SECRET');
		}
	});
}
