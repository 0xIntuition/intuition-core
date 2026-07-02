import { describe, expect, it } from 'bun:test';

import {
	isEngineVersionCompatible,
	isRuntimeCompatible,
	validatePluginManifest,
} from '../src/plugins';

describe('plugin manifest contract', () => {
	it('applies manifest defaults', () => {
		const manifest = validatePluginManifest({
			id: 'spotify-resolver',
			version: '1.0.0',
			engineRange: '^0.1.0',
			runtime: 'server',
		});

		expect(manifest.capabilities).toEqual([]);
		expect(manifest.permissions).toEqual([]);
		expect(manifest.dependsOn).toEqual([]);
		expect(manifest.provides).toEqual([]);
		expect(manifest.priority).toBe(100);
	});

	it('rejects invalid manifest ids', () => {
		expect(() =>
			validatePluginManifest({
				id: 'Bad Plugin',
				version: '1.0.0',
				engineRange: '*',
				runtime: 'universal',
			} as never)
		).toThrow();
	});

	it('evaluates runtime compatibility rules', () => {
		expect(isRuntimeCompatible('client', 'client')).toBe(true);
		expect(isRuntimeCompatible('server', 'server')).toBe(true);
		expect(isRuntimeCompatible('client', 'universal')).toBe(true);
		expect(isRuntimeCompatible('server', 'universal')).toBe(true);
		expect(isRuntimeCompatible('client', 'server')).toBe(false);
	});

	it('evaluates engine version compatibility ranges', () => {
		expect(isEngineVersionCompatible('*', '0.1.0')).toBe(true);
		expect(isEngineVersionCompatible('^0.1.0', '0.1.9')).toBe(true);
		expect(isEngineVersionCompatible('^0.1.0', '1.0.0')).toBe(false);
		expect(isEngineVersionCompatible('~0.1.2', '0.1.9')).toBe(true);
		expect(isEngineVersionCompatible('~0.1.2', '0.2.0')).toBe(false);
		expect(isEngineVersionCompatible('>=0.1.0 <0.2.0', '0.1.5')).toBe(true);
		expect(isEngineVersionCompatible('>=0.1.0 <0.2.0', '0.2.1')).toBe(false);
	});
});
