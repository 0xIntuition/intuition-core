import { describe, expect, test } from 'bun:test';
import type { ParseResult } from '@0xintuition/atom-parser/types';
import { WorkerConfigurationError } from '../shared/errors';
import {
	createIidInspectionAdapter,
	type PublicIidInspection,
	parseAtomWithIidRead,
} from './iid-inspection';

const PACKAGE_VERSION = '0.1.0-alpha.0';
const SPECIFICATION_VERSION = '@0xintuition/iid-spec@0.1.0-alpha.0';

describe('IID inspection adapter', () => {
	test('maps a public valid inspection without reconstructing colon-bearing values', async () => {
		const rawInput = 'int:tmdb:movie:603';
		const adapter = createIidInspectionAdapter({
			inspectIntuitionId: () => ({
				valid: true,
				iid: rawInput,
				scheme: 'tmdb',
				value: 'movie:603',
				class: 'C',
				typing: 'polymorphic',
				anchorEligible: false,
				anchorIneligibilityReason: 'class-c',
			}),
			packageVersion: PACKAGE_VERSION,
			specificationVersion: SPECIFICATION_VERSION,
		});
		let legacyCalls = 0;

		const outcome = await parseAtomWithIidRead({
			rawInput,
			iidReadEnabled: true,
			adapter,
			parseLegacy: () => {
				legacyCalls += 1;
				return legacyResult(rawInput);
			},
		});

		expect(legacyCalls).toBe(0);
		expect(outcome).toEqual({
			result: {
				kind: 'iid',
				normalizedInput: rawInput,
				canonicalId: rawInput,
				identity: {
					raw: rawInput,
					canonical: rawInput,
					scheme: 'tmdb',
					value: 'movie:603',
					class: 'C',
					typing: 'polymorphic',
					anchorEligible: false,
					anchorIneligibilityReason: 'class-c',
					provenance: {
						producer: '@0xintuition/iid/inspectIntuitionId',
						version: PACKAGE_VERSION,
						specificationVersion: SPECIFICATION_VERSION,
					},
				},
			},
		});
		expect(outcome.result.identity).not.toHaveProperty('profile');
	});

	test('preserves the legacy path for every invalid reason and ignores repairs', async () => {
		const cases: PublicIidInspection[] = [
			{ valid: false, reason: 'malformed' },
			{ valid: false, reason: 'unknown-scheme', scheme: 'src', value: '123' },
			{
				valid: false,
				reason: 'noncanonical',
				scheme: 'isbn',
				value: '0-684-83272-0',
				canonical: 'int:isbn:9780684832722',
			},
		];

		for (const inspection of cases) {
			const rawInput = inspection.valid ? '' : `historical-${inspection.reason}`;
			const adapter = createIidInspectionAdapter({
				inspectIntuitionId: () => inspection,
				packageVersion: PACKAGE_VERSION,
			});
			const outcome = await parseAtomWithIidRead({
				rawInput,
				iidReadEnabled: true,
				adapter,
				parseLegacy: () => legacyResult(rawInput),
			});

			expect(outcome.fallbackReason).toBe(inspection.valid ? undefined : inspection.reason);
			expect(outcome.result).toMatchObject({
				kind: 'plain_string',
				normalizedInput: rawInput,
				canonicalId: rawInput,
				iidFallback: {
					reason: inspection.valid ? undefined : inspection.reason,
					provenance: {
						producer: '@0xintuition/iid/inspectIntuitionId',
						version: PACKAGE_VERSION,
					},
				},
			});
			expect(outcome.result.identity).toBeUndefined();
		}
	});

	test('keeps disabled behavior byte-compatible and does not call public inspection', async () => {
		const rawInput = 'int:isrc:USRC17607839';
		let inspectionCalls = 0;
		const adapter = createIidInspectionAdapter({
			inspectIntuitionId: () => {
				inspectionCalls += 1;
				return validIsrcInspection(rawInput);
			},
			packageVersion: PACKAGE_VERSION,
		});

		const outcome = await parseAtomWithIidRead({
			rawInput,
			iidReadEnabled: false,
			adapter,
			parseLegacy: () => legacyResult(rawInput),
		});

		expect(inspectionCalls).toBe(0);
		expect(outcome).toEqual({
			result: {
				kind: 'plain_string',
				normalizedInput: rawInput,
				canonicalId: rawInput,
				hints: { trimmed: rawInput },
			},
		});
	});

	test('fails closed when the read flag is enabled without a public adapter', async () => {
		expect(
			parseAtomWithIidRead({
				rawInput: 'int:isrc:USRC17607839',
				iidReadEnabled: true,
				parseLegacy: () => legacyResult('int:isrc:USRC17607839'),
			})
		).rejects.toBeInstanceOf(WorkerConfigurationError);
	});
});

function validIsrcInspection(iid: string): PublicIidInspection {
	return {
		valid: true,
		iid,
		scheme: 'isrc',
		value: 'USRC17607839',
		class: 'A',
		typing: 'unambiguous',
		anchorEligible: true,
	};
}

function legacyResult(input: string): ParseResult {
	return {
		kind: 'plain_string',
		input,
		normalizedInput: input,
		warnings: [],
		structuredDocument: undefined,
		original: input,
		trimmed: input,
	};
}
