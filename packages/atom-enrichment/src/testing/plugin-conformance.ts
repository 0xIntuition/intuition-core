import { describe, expect, it } from 'bun:test';

import type { ClassificationRegistry } from '../classifications';
import type { EnrichmentPlugin } from '../plugins';
import type { EnrichmentRequest } from '../types';
import { createMockPluginContext } from './mocks';

export interface PluginConformanceFixture {
	name: string;
	request: EnrichmentRequest;
	expectedSupports: boolean;
	expectedClassifications?: string[];
}

export function runPluginConformanceSuite(
	plugin: EnrichmentPlugin,
	fixtures: PluginConformanceFixture[],
	registry: ClassificationRegistry
): void {
	describe(`Plugin conformance: ${plugin.id}`, () => {
		it('has a slug-compliant id', () => {
			expect(plugin.id).toMatch(/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/);
		});

		it('has a semver-like version', () => {
			expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
		});

		it('declares a valid runtime', () => {
			expect(['client', 'server', 'universal']).toContain(plugin.runtime);
		});

		it('declares at least one artifact type', () => {
			expect(plugin.artifactTypes.length).toBeGreaterThan(0);
		});

		it('declares only registered artifact types', () => {
			for (const slug of plugin.artifactTypes) {
				expect(registry.has(slug)).toBe(true);
			}
		});

		for (const fixture of fixtures) {
			describe(`fixture: ${fixture.name}`, () => {
				it(`supports() returns ${fixture.expectedSupports}`, async () => {
					const supports = await Promise.resolve(plugin.supports(fixture.request));
					expect(supports).toBe(fixture.expectedSupports);
				});

				if (fixture.expectedSupports) {
					it('enrich() returns schema-valid artifacts', async () => {
						const artifacts = await plugin.enrich(fixture.request, createMockPluginContext());
						expect(Array.isArray(artifacts)).toBe(true);

						for (const artifact of artifacts) {
							expect(artifact.meta.pluginId).toBe(plugin.id);
							expect(artifact.meta.provider).toBeTruthy();
							expect(artifact.meta.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
							expect(registry.validate(artifact.artifact_type, artifact.data).success).toBe(true);
						}
					});
				}

				if (fixture.expectedSupports && fixture.expectedClassifications) {
					it('contains expected classifications', async () => {
						const artifacts = await plugin.enrich(fixture.request, createMockPluginContext());
						const slugs = artifacts.map((artifact) => artifact.artifact_type);
						for (const expected of fixture.expectedClassifications ?? []) {
							expect(slugs).toContain(expected);
						}
					});
				}
			});
		}
	});
}
