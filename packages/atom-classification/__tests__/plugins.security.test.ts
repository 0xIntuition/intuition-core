import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import {
	getPluginSecurityViolations,
	type PluginManifest,
	validatePluginManifest,
} from '../src/plugins';

function manifest(
	input: Partial<PluginManifest> & Pick<PluginManifest, 'id' | 'runtime'>
): PluginManifest {
	return validatePluginManifest({
		version: '1.0.0',
		engineRange: '^0.1.0',
		capabilities: [],
		permissions: [],
		dependsOn: [],
		provides: [],
		priority: 100,
		...input,
	});
}

describe('plugin security policy contract', () => {
	it('flags AI capabilities when ai permission is missing', () => {
		const pluginManifest = manifest({
			id: 'ai-capability-without-permission',
			runtime: 'server',
			capabilities: ['resolve:ai:entity'],
			permissions: [],
		});

		const violations = getPluginSecurityViolations('server', pluginManifest);
		expect(violations.map((violation) => violation.code)).toContain('missing-ai-permission');
	});

	it('blocks ai-capable plugins in client runtime', () => {
		const engine = createClassificationEngine({
			runtime: 'client',
			autoInit: false,
		});

		expect(() =>
			engine.registerPlugin({
				manifest: manifest({
					id: 'client-ai-plugin',
					runtime: 'universal',
					capabilities: ['resolve:ai:entity'],
					permissions: ['ai'],
				}),
			})
		).toThrow(/client runtime/i);
	});

	it('allows ai-capable plugins in server runtime when permission is present', () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			autoInit: false,
		});

		expect(() =>
			engine.registerPlugin({
				manifest: manifest({
					id: 'server-ai-plugin',
					runtime: 'server',
					capabilities: ['resolve:ai:entity'],
					permissions: ['ai'],
				}),
			})
		).not.toThrow();
	});

	it('blocks client-targeted manifests from requesting ai permission', () => {
		const pluginManifest = manifest({
			id: 'client-permission-ai',
			runtime: 'client',
			permissions: ['ai'],
		});

		const violations = getPluginSecurityViolations('server', pluginManifest);
		expect(violations.map((violation) => violation.code)).toContain(
			'client-runtime-ai-permission-disallowed'
		);
	});
});
