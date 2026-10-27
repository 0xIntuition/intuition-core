import { describe, expect, test } from 'bun:test';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createClientEngine } from '@0xintuition/atom-classification/client';
import { createPlainTextPlugin } from '@0xintuition/atom-classification/plugins/plain-text';
import { createTypeProfilesPlugin } from '@0xintuition/atom-classification/plugins/type-profiles';
import { createEnrichmentEngine } from '@0xintuition/atom-enrichment';
import {
	createMockArtifact,
	createMockPlugin,
	createMockRequest,
} from '@0xintuition/atom-enrichment/testing';
import { parseAtom } from '@0xintuition/atom-parser/parse';
import { toCompactParseResult } from '../services/workers/src/core/parse';
import { toCompactParseResultMaybe } from '../services/workers/src/kg/processing';

describe('published atom runtime consumer contract', () => {
	test.each([
		'atom-parser',
		'atom-classification',
		'atom-enrichment',
	])('%s resolves compiled public exports at the pinned version', async (name) => {
		const specifier = `@0xintuition/${name}`;
		const manifest = JSON.parse(
			await readFile(fileURLToPath(import.meta.resolve(`${specifier}/package.json`)), 'utf8')
		);
		expect(manifest.version).toBe('0.1.0-alpha.0');
		expect(manifest.private).toBe(false);
		const entry = await realpath(fileURLToPath(import.meta.resolve(specifier)));
		expect(entry).toEndWith('/dist/index.js');
	});

	test('compiled parser output survives the worker persistence boundary', async () => {
		const parsed = await parseAtom('https://example.com/item', { remoteFetch: false });
		const compact = toCompactParseResultMaybe(
			JSON.parse(JSON.stringify(toCompactParseResult(parsed)))
		);
		expect(compact).not.toBeNull();
		expect(compact?.kind).toBe('url');
		expect(compact?.normalizedInput).toBe('https://example.com/item');
		expect(compact?.canonicalId).toBe('https://example.com/item');
	});

	test('compiled classification and enrichment engines execute injected plugins', async () => {
		const classified = await createClientEngine({
			plugins: [createTypeProfilesPlugin(), createPlainTextPlugin()],
		}).classify({
			input: 'a shared runtime',
			mode: 'client-only',
			classificationSessionId: 'core-consumer',
		});
		expect(classified.resolved?.classifications[0]?.type).toBe('Thing');
		const result = await createEnrichmentEngine({
			plugins: [createMockPlugin({ mockArtifacts: [createMockArtifact()] })],
		}).enrich(createMockRequest());
		expect(result.status).toBe('success');
		expect(result.artifacts.map((artifact) => artifact.artifact_type)).toEqual(['opengraph']);
	});
});
