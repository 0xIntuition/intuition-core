import { describe, expect, test } from 'bun:test';
import { detectRawType } from '../src/app';

describe('detectRawType', () => {
	test('urls', () => {
		expect(detectRawType('https://github.com/oven-sh/bun')).toBe('http_uri');
		expect(detectRawType('  HTTP://example.com  ')).toBe('http_uri');
		expect(detectRawType('ipfs://bafybeigdyrzt5s')).toBe('ipfs_uri');
	});

	test('json vs string', () => {
		expect(detectRawType('{"@type":"Person","name":"Ada"}')).toBe('json');
		expect(detectRawType('[1,2,3]')).toBe('json');
		expect(detectRawType('{not json')).toBe('string');
		expect(detectRawType('joji')).toBe('string');
		expect(detectRawType('example.com without scheme')).toBe('string');
	});
});
