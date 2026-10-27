import { describe, expect, test } from 'bun:test';
import { kgAtomId, kgTripleId } from './ids';

const SUBJECT_ID = '0x05bb6d28ed5ca3c5206f33f5818da27b3b0bbf6401cd40f082e8db7fcf481787';
const PREDICATE_ID = '0xdb3dc8c92d6141c4e0c9b453b00fc1f237624ef8373b6ae9972d09557d8aaa8d';
const OBJECT_ID = '0x39afce29ac0e4be2400fa0421b537f63ad2d78d7f8b4be4ff839a162ff3e5ffc';
const TRIPLE_ID = '0x57946a02776dbd4eec339ecf5cdf6e0005b8de381fb3d9a2bf303da083bf5166';

describe('deterministic protocol term ids', () => {
	test('kgTripleId matches the @0xintuition/ids known answer', () => {
		// Parity lock: this exact vector is documented in @0xintuition/ids.
		// If this test fails, the derivation forked — that is an identity break.
		expect(
			kgTripleId({
				subject: {
					type: 'node',
					id: SUBJECT_ID,
				},
				predicate: {
					type: 'node',
					id: PREDICATE_ID,
				},
				object: {
					type: 'node',
					id: OBJECT_ID,
				},
			})
		).toBe(TRIPLE_ID);
	});

	test('preserves Core prefix normalization before public triple derivation', () => {
		expect(
			kgTripleId({
				subject: { type: 'node', id: ` atom:${SUBJECT_ID} ` },
				predicate: { type: 'node', id: `triple:${PREDICATE_ID}` },
				object: { type: 'node', id: OBJECT_ID },
			})
		).toBe(TRIPLE_ID);
	});

	test('locks public atom derivation for UTF-8, raw hex, IID, and legacy JSON inputs', () => {
		const fixtures = [
			{
				input: 'hello',
				expected: '0xa0e157e5fa1b17d3b54ec73622ce3317296920a06502661617613d59f58e947e',
			},
			{
				input: '0x68656c6c6f',
				expected: '0xa0e157e5fa1b17d3b54ec73622ce3317296920a06502661617613d59f58e947e',
			},
			{
				input: 'int:isrc:USRC17607839',
				expected: '0xd3368a8190d3afd5fb05abd01db8141c09a77c3f290bb7a0ef2ffb2b5acab8d8',
			},
			{
				input: '{"@context":"https://schema.org","@type":"MusicRecording","name":"One Last Time"}',
				expected: '0x9500b299bfb982c6c11574351aef0b12ffa82f1856c141a2d090b071a9714349',
			},
		] as const;

		for (const fixture of fixtures) {
			expect(kgAtomId(fixture.input)).toBe(fixture.expected);
		}
	});
});
