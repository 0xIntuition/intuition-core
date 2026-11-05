import { describe, expect, test } from 'bun:test';
import {
	BASELINE_PREDICATES,
	PREDICATE_IDS,
	TRUSTED_IN_THE_CONTEXT_OF_PREDICATE_IPFS_URI,
	TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID,
} from './predicates';

describe('BASELINE_PREDICATES seed parity', () => {
	test('derives TRUSTED_IN_THE_CONTEXT_OF via @0xintuition/predicates + @0xintuition/ids and preserves byte-identical seed ids', () => {
		expect(TRUSTED_IN_THE_CONTEXT_OF_PREDICATE_IPFS_URI).toBe(
			'ipfs://bafkreiddr2xcndrxhusfh7ozezlgsnyoekhhveb4uby4vasabh2ywxcv74'
		);
		expect(TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID).toBe(
			'0x0840db4575bf6bdb49b66c21dc40cb4cbb5e1b26bd239d7f56b126c14e452c07'
		);
		expect(PREDICATE_IDS.TRUSTED_IN_THE_CONTEXT_OF).toBe(
			'0x0840db4575bf6bdb49b66c21dc40cb4cbb5e1b26bd239d7f56b126c14e452c07'
		);
		const trustedEntry = BASELINE_PREDICATES.find((p) => p.slug === 'trusted-in-the-context-of');
		expect(trustedEntry?.id).toBe(
			'0x0840db4575bf6bdb49b66c21dc40cb4cbb5e1b26bd239d7f56b126c14e452c07'
		);
	});
});
