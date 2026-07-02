import { describe, expect, test } from 'bun:test';
import {
	getProcessingMetaString,
	toClassificationResultMaybe,
	toCompactParseResultMaybe,
} from './processing';

describe('KG processing helpers', () => {
	test('reads run ids from processing metadata', () => {
		expect(getProcessingMetaString({ parseRunId: 'run-1' }, 'parseRunId')).toBe('run-1');
		expect(() => getProcessingMetaString({}, 'parseRunId')).toThrow(/parseRunId/);
		expect(() => getProcessingMetaString(null, 'parseRunId')).toThrow(/parseRunId/);
	});

	test('validates compact parse result shape', () => {
		expect(
			toCompactParseResultMaybe({
				kind: 'json',
				normalizedInput: '{}',
				structuredDocument: { topLevelType: 'object' },
			})
		).toMatchObject({ kind: 'json', normalizedInput: '{}' });
		expect(toCompactParseResultMaybe({ kind: 'json' })).toBeNull();
		expect(toCompactParseResultMaybe({ kind: '', normalizedInput: '{}' })).toBeNull();
		expect(toCompactParseResultMaybe([])).toBeNull();
	});

	test('validates classification result shape', () => {
		expect(
			toClassificationResultMaybe({
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'WebSite',
			})
		).toMatchObject({ status: 'recognized', schemaType: 'WebSite' });
		expect(toClassificationResultMaybe({ status: 'recognized' })).toBeNull();
		expect(toClassificationResultMaybe({ status: 'done', source: 'inline_json' })).toBeNull();
		expect(toClassificationResultMaybe('recognized')).toBeNull();
	});
});
