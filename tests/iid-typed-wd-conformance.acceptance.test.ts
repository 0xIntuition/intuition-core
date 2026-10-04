import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	createIidInspectionAdapter,
	type PublicIidInspection,
	parseAtomWithIidRead,
} from '../services/workers/src/core/iid-inspection';
import { toCompactParseResultMaybe } from '../services/workers/src/kg/processing';

type Inspection = PublicIidInspection & { profile?: 'p0' | 'p1' | 'p2' };
type PublicIidModule = {
	inspectIntuitionId(input: string): Inspection;
	getScheme(scheme: string): { canonicalize(raw: string): string | undefined } | undefined;
	parseIntuitionId(input: string): { scheme: string; value: string } | undefined;
};
type Vector = {
	id: string;
	scheme?: string | null;
	raw?: string;
	canonical?: string | null;
	iid?: string;
	input?: string;
	value?: string | null;
	valid?: boolean;
	anchorEligible?: boolean;
	typing?: string;
};

const packagesRepository = process.env.INTUITION_PACKAGES_REPO
	? resolve(process.env.INTUITION_PACKAGES_REPO)
	: resolve(import.meta.dir, '../../packages');
const iidEntry = join(packagesRepository, 'packages/iid/dist/index.js');
const corpus = join(packagesRepository, 'packages/iid-spec/conformance');
const describeWithPublicPackages =
	existsSync(iidEntry) && existsSync(corpus) ? describe : describe.skip;

function vectors(kind: string): Vector[] {
	const data = JSON.parse(readFileSync(join(corpus, `${kind}.json`), 'utf8')) as {
		vectors: Vector[];
	};
	return data.vectors.filter((vector) => {
		const iid = vector.iid ?? vector.input ?? '';
		return (
			vector.scheme === 'wd' ||
			iid.startsWith('int:wd:') ||
			(iid.startsWith('int:') && iid.slice(iid.indexOf(':', 4) + 1).includes(':')) ||
			(vector.scheme != null && vector.raw?.includes(':') === true)
		);
	});
}

async function inspectThroughCore(module: PublicIidModule, iid: string) {
	const adapter = createIidInspectionAdapter({
		inspectIntuitionId: module.inspectIntuitionId,
		packageVersion: '0.1.0-alpha.0',
	});
	return parseAtomWithIidRead({
		rawInput: iid,
		iidReadEnabled: true,
		adapter,
		parseLegacy: () => ({
			kind: 'plain_string',
			input: iid,
			normalizedInput: iid,
			warnings: [],
			structuredDocument: undefined,
			original: iid,
			trimmed: iid,
		}),
	});
}

describeWithPublicPackages('typed Wikidata inspection conformance', () => {
	test('exercises a nontrivial corpus, including bare, typed and colon-bearing wd values', () => {
		// Coverage is counted ONLY from the field each corpus's assertion reads (canonicalization:
		// the expected canonical, falling back to raw for rejected inputs; validation: iid; parse:
		// input), so unused fields cannot fabricate coverage. A value is bare only when it is
		// exactly a QID; typed only when it starts with a slug followed by a colon. URLs count as
		// neither. Counts are per corpus so one corpus cannot stand in for another.
		const ASSERTED_FIELD: Record<string, (vector: Vector) => string | undefined> = {
			canonicalization: (vector) => vector.canonical ?? vector.raw ?? undefined,
			validation: (vector) => vector.iid,
			parse: (vector) => vector.input,
		};
		const perCorpus: Record<string, { wd: number; typed: number; bare: number }> = {};
		const typedForms = { active: false, dormant: false, invalid: false };
		for (const kind of ['canonicalization', 'validation', 'parse']) {
			const selected = vectors(kind);
			const wd = selected.filter(
				(vector) => vector.scheme === 'wd' || (vector.iid ?? vector.input)?.startsWith('int:wd:')
			);
			const counts = { wd: wd.length, typed: 0, bare: 0 };
			for (const vector of wd) {
				const asserted = ASSERTED_FIELD[kind](vector);
				if (typeof asserted !== 'string') continue;
				const value = asserted.startsWith('int:wd:') ? asserted.slice('int:wd:'.length) : asserted;
				if (/^Q\d+$/.test(value)) {
					counts.bare += 1;
					continue;
				}
				const typed = /^[a-z][a-z-]*:/.exec(value);
				if (!typed) continue;
				counts.typed += 1;
				const slug = typed[0].slice(0, -1);
				const rest = value.slice(typed[0].length);
				if ((slug === 'film' || slug === 'human') && /^Q\d+$/.test(rest)) typedForms.active = true;
				if (slug === 'written-work' && /^Q\d+$/.test(rest)) typedForms.dormant = true;
				if (!/^Q\d+$/.test(rest) || slug === 'bogus') typedForms.invalid = true;
			}
			perCorpus[kind] = counts;
			console.info(
				`${kind}: ${selected.length} vectors (${counts.wd} wd, ${counts.typed} typed, ${counts.bare} bare)`
			);
		}
		expect(perCorpus.canonicalization.typed).toBeGreaterThanOrEqual(5);
		expect(perCorpus.validation.typed).toBeGreaterThanOrEqual(5);
		expect(perCorpus.parse.typed).toBeGreaterThanOrEqual(1);
		for (const kind of ['canonicalization', 'validation', 'parse']) {
			expect(perCorpus[kind].bare, `${kind} bare`).toBeGreaterThanOrEqual(1);
		}
		expect(typedForms).toEqual({ active: true, dormant: true, invalid: true });
	});

	test('canonicalizes explicitly through the module before Core inspection', async () => {
		const module = await importModule<PublicIidModule>(iidEntry);
		for (const vector of vectors('canonicalization')) {
			const canonical = module.getScheme(vector.scheme!)?.canonicalize(vector.raw!);
			expect(canonical ?? null, vector.id).toBe(vector.canonical);
			if (canonical !== undefined) {
				const iid = `int:${vector.scheme}:${canonical}`;
				const outcome = await inspectThroughCore(module, iid);
				expect(outcome.result.identity?.canonical, vector.id).toBe(iid);
			} else {
				const outcome = await inspectThroughCore(module, `int:${vector.scheme}:${vector.raw}`);
				expect(outcome.result.identity, vector.id).toBeUndefined();
			}
		}
	});

	test('preserves validity, typing, eligibility and the module reason without repairing writes', async () => {
		const module = await importModule<PublicIidModule>(iidEntry);
		for (const vector of vectors('validation')) {
			const inspection = module.inspectIntuitionId(vector.iid!);
			const outcome = await inspectThroughCore(module, vector.iid!);
			expect(inspection.valid, vector.id).toBe(vector.valid);
			expect(Boolean(outcome.result.identity), vector.id).toBe(vector.valid);
			expect(outcome.result.identity?.anchorEligible ?? false, vector.id).toBe(
				vector.anchorEligible
			);
			if (inspection.valid) {
				expect(toCompactParseResultMaybe(outcome.result), vector.id).toEqual(outcome.result);
				expect(outcome.result.identity?.typing, vector.id).toBe(inspection.typing);
				if (vector.typing) expect(inspection.typing, vector.id).toBe(vector.typing);
				expect(outcome.result.identity?.anchorIneligibilityReason, vector.id).toBe(
					inspection.anchorIneligibilityReason
				);
			} else {
				expect(outcome.fallbackReason, vector.id).toBe(inspection.reason);
				expect(outcome.result.canonicalId, vector.id).toBe(vector.iid);
			}
		}
	});

	test('retains scheme, entire value, typing and profile as reported by the module', async () => {
		const module = await importModule<PublicIidModule>(iidEntry);
		for (const vector of vectors('parse')) {
			const parsed = module.parseIntuitionId(vector.input!);
			expect(parsed?.scheme ?? null, vector.id).toBe(vector.scheme);
			expect(parsed?.value ?? null, vector.id).toBe(vector.value);
			const inspection = module.inspectIntuitionId(vector.input!);
			const outcome = await inspectThroughCore(module, vector.input!);
			if (inspection.valid) {
				expect(outcome.result.identity, vector.id).toMatchObject(parsed!);
				expect(toCompactParseResultMaybe(outcome.result), vector.id).toEqual(outcome.result);
				expect(outcome.result.identity?.typing, vector.id).toBe(inspection.typing);
				expect(outcome.result.identity?.profile, vector.id).toBe(inspection.profile);
			} else {
				expect(outcome.result.identity, vector.id).toBeUndefined();
			}
		}
	});

	test('round-trips dormant typed Wikidata identity through the worker handoff', async () => {
		const module = await importModule<PublicIidModule>(iidEntry);
		const outcome = await inspectThroughCore(module, 'int:wd:written-work:Q47461344');
		expect(outcome.result.identity).toMatchObject({
			value: 'written-work:Q47461344',
			anchorEligible: false,
			anchorIneligibilityReason: 'dormant-wd-binding',
		});
		expect(toCompactParseResultMaybe(outcome.result)).toEqual(outcome.result);
	});
});

async function importModule<T>(entry: string): Promise<T> {
	return (await import(pathToFileURL(entry).href)) as T;
}
