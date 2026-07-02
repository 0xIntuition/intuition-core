import { describe, expect, test } from 'bun:test';
import { kgAtomId, kgTripleId } from './ids';

describe('deterministic protocol term ids', () => {
	test('kgTripleId matches the @0xintuition/ids known answer', () => {
		// Parity lock: this exact vector is documented in @0xintuition/ids.
		// If this test fails, the derivation forked — that is an identity break.
		expect(
			kgTripleId({
				subject: {
					type: 'node',
					id: '0x05bb6d28ed5ca3c5206f33f5818da27b3b0bbf6401cd40f082e8db7fcf481787',
				},
				predicate: {
					type: 'node',
					id: '0xdb3dc8c92d6141c4e0c9b453b00fc1f237624ef8373b6ae9972d09557d8aaa8d',
				},
				object: {
					type: 'node',
					id: '0x39afce29ac0e4be2400fa0421b537f63ad2d78d7f8b4be4ff839a162ff3e5ffc',
				},
			})
		).toBe('0x57946a02776dbd4eec339ecf5cdf6e0005b8de381fb3d9a2bf303da083bf5166');
	});

	test('kgAtomId is deterministic and 32 bytes', () => {
		const a = kgAtomId('https://example.com');
		expect(a).toBe(kgAtomId('https://example.com'));
		expect(a).toMatch(/^0x[0-9a-f]{64}$/);
		expect(kgAtomId('something else')).not.toBe(a);
	});
});
