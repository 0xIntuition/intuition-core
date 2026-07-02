import { describe, expect, it } from 'bun:test';

import { academicPreset, companyPreset, cryptoPreset, musicPreset } from '../src/presets';

function pluginIds(plugins: Array<{ id: string }>): string[] {
	return plugins.map((plugin) => plugin.id);
}

describe('preset bundles', () => {
	it('companyPreset composes opengraph, brand, favicon in deterministic order', () => {
		const plugins = companyPreset();
		expect(pluginIds(plugins)).toEqual(['opengraph', 'brand', 'favicon']);
	});

	it('musicPreset composes opengraph, spotify, musicbrainz, and apple-music', () => {
		const plugins = musicPreset();
		expect(pluginIds(plugins)).toEqual(['opengraph', 'spotify', 'musicbrainz', 'apple-music']);
	});

	it('cryptoPreset composes etherscan and coingecko', () => {
		const plugins = cryptoPreset();
		expect(pluginIds(plugins)).toEqual(['etherscan', 'coingecko']);
	});

	it('academicPreset composes crossref and wikipedia', () => {
		const plugins = academicPreset();
		expect(pluginIds(plugins)).toEqual(['crossref', 'wikipedia']);
	});

	it('propagates options to underlying plugin manifests', () => {
		const [opengraph, brand, favicon] = companyPreset({
			opengraph: { priority: 91, TTL: 12_345 },
			brand: { priority: 92, TTL: 23_456 },
			favicon: { priority: 93, TTL: 34_567, size: 64 },
		});
		expect(opengraph?.priority).toBe(91);
		expect(opengraph?.TTL).toBe(12_345);
		expect(brand?.priority).toBe(92);
		expect(brand?.TTL).toBe(23_456);
		expect(favicon?.priority).toBe(93);
		expect(favicon?.TTL).toBe(34_567);

		const [etherscan, coingecko] = cryptoPreset({
			etherscan: { priority: 94, TTL: 45_678 },
			coingecko: { priority: 95, TTL: 56_789, platformId: 'ethereum' },
		});
		expect(etherscan?.priority).toBe(94);
		expect(etherscan?.TTL).toBe(45_678);
		expect(coingecko?.priority).toBe(95);
		expect(coingecko?.TTL).toBe(56_789);

		const [crossref, wikipedia] = academicPreset({
			crossref: { priority: 96, TTL: 67_890 },
			wikipedia: { priority: 97, TTL: 78_901, language: 'en' },
		});
		expect(crossref?.priority).toBe(96);
		expect(crossref?.TTL).toBe(67_890);
		expect(wikipedia?.priority).toBe(97);
		expect(wikipedia?.TTL).toBe(78_901);
	});
});
