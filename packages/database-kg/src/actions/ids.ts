import { encodePacked, type Hex, isHex, keccak256, toHex } from 'viem';
import type { TripleInput } from './types';

const PROTOCOL_TERM_ID_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Protocol-defined salt for atom ID derivation: `keccak256(toHex('ATOM_SALT'))`.
 */
const ATOM_SALT: Hex = keccak256(toHex('ATOM_SALT'));

/**
 * Protocol-defined salt for triple ID derivation: `keccak256(toHex('TRIPLE_SALT'))`.
 * Value: `0x23ad11f0a1505378b82984192ad0461e6a012820fc5bf2e4ba16513f8e430552`.
 */
const TRIPLE_SALT: Hex = keccak256(toHex('TRIPLE_SALT'));

/**
 * Compute a deterministic atom ID from raw atom data.
 *
 * The algorithm mirrors the on-chain derivation:
 * 1. Convert `atomData` to hex if it is a plain string.
 * 2. Hash the hex data with keccak256.
 * 3. Pack `[ATOM_SALT, keccak256(data)]` and hash again.
 *
 * The result is deterministic: identical atom data always produces the same
 * ID regardless of caller or timestamp.
 */
export function kgAtomId(atomData: string): string {
	const data: Hex = isHex(atomData) ? atomData : toHex(atomData);
	return keccak256(encodePacked(['bytes32', 'bytes'], [ATOM_SALT, keccak256(data)]));
}

/**
 * Compute a deterministic triple ID from its subject/predicate/object term ids.
 *
 * Mirrors the on-chain derivation:
 * `keccak256(encodePacked([TRIPLE_SALT, subjectId, predicateId, objectId]))`.
 *
 * Known answer (parity-locked against `@0xintuition/ids`):
 * subject   0x05bb6d28ed5ca3c5206f33f5818da27b3b0bbf6401cd40f082e8db7fcf481787
 * predicate 0xdb3dc8c92d6141c4e0c9b453b00fc1f237624ef8373b6ae9972d09557d8aaa8d
 * object    0x39afce29ac0e4be2400fa0421b537f63ad2d78d7f8b4be4ff839a162ff3e5ffc
 * → triple  0x57946a02776dbd4eec339ecf5cdf6e0005b8de381fb3d9a2bf303da083bf5166
 */
export function kgTripleId(input: TripleInput): string {
	return keccak256(
		encodePacked(
			['bytes32', 'bytes32', 'bytes32', 'bytes32'],
			[
				TRIPLE_SALT,
				normalizeProtocolTermId(input.subject.id, 'subject.id'),
				normalizeProtocolTermId(input.predicate.id, 'predicate.id'),
				normalizeProtocolTermId(input.object.id, 'object.id'),
			]
		)
	);
}

export function isProtocolTermId(value: string): value is `0x${string}` {
	return PROTOCOL_TERM_ID_RE.test(value);
}

/**
 * Strip an optional `atom:`/`triple:` prefix and validate, returning the
 * normalized protocol term id — or `null` when the value isn't one. Use this for
 * batch reads over mixed/legacy node ids where a non-protocol id (e.g. a seed
 * integer id) should be skipped rather than abort the whole operation.
 */
export function tryNormalizeProtocolTermId(value: string): `0x${string}` | null {
	const trimmed = value.trim();
	const normalized =
		trimmed.startsWith('atom:') || trimmed.startsWith('triple:')
			? trimmed.slice(trimmed.indexOf(':') + 1)
			: trimmed;

	return isProtocolTermId(normalized) ? normalized : null;
}

export function normalizeProtocolTermId(value: string, label = 'termId'): `0x${string}` {
	const normalized = tryNormalizeProtocolTermId(value);

	if (normalized === null) {
		throw new Error(`${label} must be a 32-byte 0x-prefixed protocol term id.`);
	}

	return normalized;
}
