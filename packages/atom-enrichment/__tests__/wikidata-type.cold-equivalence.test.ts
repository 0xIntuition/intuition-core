import { expect, test } from 'bun:test';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createWikipediaPlugin } from '../src/plugins/providers/wikipedia';
import snapshot from './fixtures/wikidata-type.cold-e052eb7.json';
import { runColdMatrix } from './fixtures/wikidata-type.cold-matrix';

test('I-1: both cold providers through the engine equal the e052eb7 recorded matrix', async () => {
	const outputs = await runColdMatrix({
		wikipedia: createWikipediaPlugin,
		wikidata: createWikidataPlugin,
	});
	for (const [row, output] of Object.entries(outputs)) {
		expect(output, row).toEqual(snapshot.outputs[row as keyof typeof snapshot.outputs]);
	}
});
