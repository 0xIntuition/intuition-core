import { describe, expect, it } from 'bun:test';
import { z } from 'zod/v4';

import { type AtomClassificationPlugin, createClassificationEngine } from '../src';

type PluginFactoryOptions = {
	priority?: number;
	runtime?: 'client' | 'server' | 'universal';
	dependsOn?: string[];
	engineRange?: string;
	hooks?: AtomClassificationPlugin['hooks'];
	registerTypes?: AtomClassificationPlugin['registerTypes'];
};

function createPlugin(id: string, options: PluginFactoryOptions = {}): AtomClassificationPlugin {
	return {
		manifest: {
			id,
			version: '1.0.0',
			engineRange: options.engineRange ?? '^0.1.0',
			runtime: options.runtime ?? 'universal',
			capabilities: [],
			permissions: [],
			dependsOn: options.dependsOn ?? [],
			provides: [],
			priority: options.priority ?? 100,
		},
		hooks: options.hooks,
		registerTypes: options.registerTypes,
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function appendTrace(metadata: Readonly<Record<string, unknown>>, label: string): string[] {
	const existing = Array.isArray(metadata.trace)
		? metadata.trace.filter((value): value is string => typeof value === 'string')
		: [];

	return [...existing, label];
}

describe('engine plugin runtime contract', () => {
	it('orders plugins deterministically with dependencies', async () => {
		const engine = createClassificationEngine({ runtime: 'server', autoInit: false });

		engine.registerPlugin(createPlugin('foundation', { priority: 50 }));
		engine.registerPlugin(
			createPlugin('resolver-adapter', {
				priority: 5,
				dependsOn: ['foundation'],
			})
		);
		engine.registerPlugin(
			createPlugin('hook-observer', {
				priority: 10,
				dependsOn: ['foundation'],
			})
		);

		const initialized = await engine.init();

		expect(initialized.pluginOrder).toEqual(['foundation', 'resolver-adapter', 'hook-observer']);
		expect(engine.getPluginOrder()).toEqual(['foundation', 'resolver-adapter', 'hook-observer']);
	});

	it('rejects plugin dependency cycles', async () => {
		const engine = createClassificationEngine({ runtime: 'server', autoInit: false });

		engine.registerPlugin(createPlugin('alpha', { dependsOn: ['beta'] }));
		engine.registerPlugin(createPlugin('beta', { dependsOn: ['alpha'] }));

		await expect(engine.init()).rejects.toThrow(/cycle/i);
	});

	it('rejects missing dependencies', async () => {
		const engine = createClassificationEngine({ runtime: 'server', autoInit: false });
		engine.registerPlugin(createPlugin('alpha', { dependsOn: ['missing-plugin'] }));

		await expect(engine.init()).rejects.toThrow(/missing plugin/i);
	});

	it('enforces runtime and engineRange compatibility at registration time', () => {
		const clientEngine = createClassificationEngine({ runtime: 'client', autoInit: false });

		expect(() =>
			clientEngine.registerPlugin(
				createPlugin('server-only-plugin', {
					runtime: 'server',
				})
			)
		).toThrow(/cannot run/i);

		expect(() =>
			clientEngine.registerPlugin(
				createPlugin('future-plugin', {
					engineRange: '>=1.0.0',
				})
			)
		).toThrow(/engineRange/i);
	});

	it('executes hooks deterministically with timeout and failure isolation', async () => {
		const onErrorEvents: string[] = [];
		const engine = createClassificationEngine({
			runtime: 'server',
			autoInit: false,
			hookTimeoutMs: 10,
		});

		engine.registerPlugin(
			createPlugin('rewriter', {
				priority: 10,
				hooks: {
					beforeClassify: (context) => {
						return {
							request: {
								input: 'https://rewritten.example/resource/123',
							},
							metadata: {
								trace: appendTrace(context.metadata, 'rewriter'),
							},
						};
					},
				},
			})
		);

		engine.registerPlugin(
			createPlugin('observer', {
				priority: 20,
				dependsOn: ['rewriter'],
				hooks: {
					beforeClassify: (context) => {
						return {
							metadata: {
								trace: appendTrace(context.metadata, 'observer'),
								observedInput: context.request.input,
							},
						};
					},
				},
			})
		);

		engine.registerPlugin(
			createPlugin('slow-plugin', {
				priority: 30,
				hooks: {
					beforeClassify: async () => {
						await delay(25);
						return {
							metadata: {
								trace: ['slow-plugin'],
							},
						};
					},
					onError: ({ pluginId, stage }) => {
						onErrorEvents.push(`${pluginId}:${stage}`);
					},
				},
			})
		);

		engine.registerPlugin(
			createPlugin('throwing-plugin', {
				priority: 40,
				hooks: {
					beforeResolve: () => {
						throw new Error('beforeResolve failed');
					},
					onError: ({ pluginId, stage }) => {
						onErrorEvents.push(`${pluginId}:${stage}`);
					},
				},
			})
		);

		engine.registerPlugin(
			createPlugin('finisher', {
				priority: 50,
				hooks: {
					afterMerge: (context) => {
						return {
							result: {
								message: `Hook finalizer: ${context.runtime}`,
							},
						};
					},
				},
			})
		);

		await engine.init();

		const result = await engine.classify({
			input: 'https://initial.example',
			mode: 'progressive',
			classificationSessionId: 'session-hooks',
		});

		expect(result.ok).toBe(true);
		expect(result.message).toBe('Hook finalizer: server');
		expect(result.debug.inputPreview).toContain('https://rewritten.example/resource/123');

		const metadata = engine.getLastMetadata();
		expect(metadata.trace).toEqual(['rewriter', 'observer']);
		expect(metadata.observedInput).toBe('https://rewritten.example/resource/123');

		const hookErrors = engine.getLastHookErrors();
		expect(hookErrors).toHaveLength(2);
		expect(hookErrors.map((error) => error.pluginId).sort()).toEqual([
			'slow-plugin',
			'throwing-plugin',
		]);
		expect(onErrorEvents.sort()).toEqual([
			'slow-plugin:beforeClassify',
			'throwing-plugin:beforeResolve',
		]);
	});

	it('registers types via plugins and enforces duplicate collision policy', async () => {
		const engine = createClassificationEngine({ runtime: 'server', autoInit: false });

		engine.registerPlugin(
			createPlugin('person-type-plugin', {
				registerTypes: (registry) => {
					registry.register({
						type: 'Person',
						category: 'person',
						schema: z.object({ name: z.string() }),
						requiredFields: ['name'],
						recommendedFields: ['description'],
						identityFields: ['sameAs'],
					});
				},
			})
		);

		engine.registerPlugin(
			createPlugin('duplicate-person-plugin', {
				dependsOn: ['person-type-plugin'],
				registerTypes: (registry) => {
					registry.register({
						type: 'Person',
						category: 'person',
						schema: z.object({ name: z.string(), image: z.string().optional() }),
						requiredFields: ['name'],
						recommendedFields: ['description', 'image'],
						identityFields: ['sameAs'],
					});
				},
			})
		);

		await expect(engine.init()).rejects.toThrow(/already registered/i);

		const overrideEngine = createClassificationEngine({ runtime: 'server', autoInit: false });
		overrideEngine.registerPlugin(
			createPlugin('person-type-plugin', {
				registerTypes: (registry) => {
					registry.register({
						type: 'Person',
						category: 'person',
						schema: z.object({ name: z.string() }),
						requiredFields: ['name'],
						recommendedFields: ['description'],
						identityFields: ['sameAs'],
					});
				},
			})
		);
		overrideEngine.registerPlugin(
			createPlugin('override-person-plugin', {
				dependsOn: ['person-type-plugin'],
				registerTypes: (registry) => {
					registry.register(
						{
							type: 'Person',
							category: 'person',
							schema: z.object({ name: z.string(), image: z.string().optional() }),
							requiredFields: ['name'],
							recommendedFields: ['description', 'image'],
							identityFields: ['sameAs'],
						},
						{ allowOverride: true }
					);
				},
			})
		);

		const initialized = await overrideEngine.init();
		expect(initialized.typeCount).toBe(1);
		expect(overrideEngine.listTypes()[0]?.recommendedFields).toEqual(['description', 'image']);
	});
});
