import { describe, expect, test } from 'bun:test';

import { parseIidReconciliationOptions } from './index';

describe('IID reconciliation command options', () => {
	test('is a bounded dry run by default', () => {
		expect(parseIidReconciliationOptions([])).toEqual({
			limit: 100,
			after: undefined,
			confirmed: false,
			force: false,
			parseVersion: 'unknown',
			registryVersion: 'unknown',
			resolverVersion: 'unknown',
		});
	});

	test('records resume and package provenance for an applied batch', () => {
		expect(
			parseIidReconciliationOptions([
				'--yes',
				'--force',
				'--limit=25',
				'--after=0xabc',
				'--parse-version=@0xintuition/iid@0.1.0-alpha.0',
				'--registry-version=@0xintuition/iid-registry@0.1.0-alpha.0',
				'--resolver-version=core-provider-adapter@1',
			])
		).toEqual({
			limit: 25,
			after: '0xabc',
			confirmed: true,
			force: true,
			parseVersion: '@0xintuition/iid@0.1.0-alpha.0',
			registryVersion: '@0xintuition/iid-registry@0.1.0-alpha.0',
			resolverVersion: 'core-provider-adapter@1',
		});
	});

	test('rejects unbounded or empty options', () => {
		expect(() => parseIidReconciliationOptions(['--limit=1001'])).toThrow('<= 1000');
		expect(() => parseIidReconciliationOptions(['--after='])).toThrow('non-empty');
	});
});
