import { z } from 'zod/v4';
import type { JsonLdTypeDefinition, RegisterTypeOptions } from './type-registry';
import type {
	ClassificationClientClassificationHint,
	ClassificationEntityCategory,
	ClassificationRequest,
	ClassificationResult,
	ClassificationRuntime,
} from './types';

export const ENGINE_VERSION = '0.1.0';

export const runtimeTargetSchema = z.enum(['client', 'server', 'universal']);
export const resolverExecutionModeSchema = z.enum(['deterministic', 'server-enrichment']);

export const pluginManifestSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
		version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/),
		engineRange: z.string().min(1),
		runtime: runtimeTargetSchema,
		capabilities: z.array(z.string().min(1)).default([]),
		permissions: z.array(z.enum(['network', 'ai'])).default([]),
		dependsOn: z.array(z.string()).default([]),
		provides: z.array(z.string()).default([]),
		priority: z.number().int().default(100),
	})
	.strict();

export type RuntimeTarget = z.infer<typeof runtimeTargetSchema>;
export type ResolverExecutionMode = z.infer<typeof resolverExecutionModeSchema>;
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginSecurityViolation = {
	code:
		| 'missing-ai-permission'
		| 'runtime-ai-disallowed'
		| 'client-runtime-ai-permission-disallowed';
	message: string;
};

export type HookStage =
	| 'beforeClassify'
	| 'afterClassify'
	| 'beforeResolve'
	| 'afterResolve'
	| 'beforeMerge'
	| 'afterMerge';

export type HookPatch = {
	request?: Partial<ClassificationRequest>;
	result?: Partial<ClassificationResult>;
	metadata?: Record<string, unknown>;
};

export type HookContext = {
	stage: HookStage;
	runtime: ClassificationRuntime;
	request: Readonly<ClassificationRequest>;
	result?: Readonly<ClassificationResult>;
	metadata: Readonly<Record<string, unknown>>;
};

export type HookErrorContext = HookContext & {
	error: Error;
	pluginId: string;
};

export type HookHandlers = {
	beforeClassify?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	afterClassify?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	beforeResolve?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	afterResolve?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	beforeMerge?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	afterMerge?: (context: HookContext) => HookPatch | Promise<HookPatch | undefined> | undefined;
	onError?: (context: HookErrorContext) => Promise<void> | void;
};

export type HookExecutionError = {
	pluginId: string;
	stage: HookStage;
	message: string;
	timestamp: string;
};

export type AtomClassifier = {
	id: string;
	priority?: number;
	runtime?: RuntimeTarget;
	classify: (
		input: string,
		request: Readonly<ClassificationRequest>
	) =>
		| ClassificationClientClassificationHint
		| Promise<ClassificationClientClassificationHint | null | undefined>
		| null
		| undefined;
};

export type ResolverAtom = {
	schemaType: string;
	category: ClassificationEntityCategory;
	title: string;
	description?: string;
	canonicalId?: string;
	sameAs?: string[];
	source?: string;
	confidence?: number;
	data?: Record<string, unknown>;
	hints?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

export type ResolverClassification = {
	type: string;
	data: Record<string, unknown>;
	meta?: {
		pluginId?: string;
		provider?: string;
		fetchedAt?: string;
		sourceUrl?: string;
		confidence?: number;
		[key: string]: unknown;
	};
};

export type ResolverResult = {
	atoms?: ResolverAtom[];
	classifications?: ResolverClassification[];
	fallbackUsed?: boolean;
	metadata?: Record<string, unknown>;
};

export type ResolverContext = {
	runtime: ClassificationRuntime;
	request: Readonly<ClassificationRequest>;
	classification: Readonly<ClassificationClientClassificationHint>;
	now: string;
};

export type AtomResolver = {
	id: string;
	priority?: number;
	runtime?: RuntimeTarget;
	executionMode?: ResolverExecutionMode;
	cacheTtlSeconds?: number;
	canResolve: (
		classification: Readonly<ClassificationClientClassificationHint>,
		request: Readonly<ClassificationRequest>
	) => boolean;
	resolve: (
		context: ResolverContext
	) => ResolverResult | Promise<ResolverResult | null | undefined> | null | undefined;
};

export type AtomClassificationPlugin = {
	manifest: PluginManifest;
	classifiers?: AtomClassifier[];
	resolvers?: AtomResolver[];
	hooks?: HookHandlers;
	registerTypes?: (registry: {
		register: (definition: JsonLdTypeDefinition, options?: RegisterTypeOptions) => void;
	}) => void;
};

export function validatePluginManifest(manifest: unknown): PluginManifest {
	return pluginManifestSchema.parse(manifest);
}

export function isRuntimeCompatible(
	engineRuntime: ClassificationRuntime,
	pluginRuntime: RuntimeTarget
): boolean {
	if (pluginRuntime === 'universal') {
		return true;
	}

	return pluginRuntime === engineRuntime;
}

export function isEngineVersionCompatible(range: string, version: string): boolean {
	const trimmed = range.trim();

	if (trimmed === '*' || trimmed === '') {
		return true;
	}

	const comparators = trimmed.split(/\s+/).filter(Boolean);
	return comparators.every((comparator) => evaluateComparator(comparator, version));
}

export function getPluginSecurityViolations(
	engineRuntime: ClassificationRuntime,
	manifest: PluginManifest
): PluginSecurityViolation[] {
	const violations: PluginSecurityViolation[] = [];
	const aiCapabilities = manifest.capabilities.filter((capability) => usesAiCapability(capability));
	const hasAiPermission = manifest.permissions.includes('ai');

	if (aiCapabilities.length > 0 && !hasAiPermission) {
		violations.push({
			code: 'missing-ai-permission',
			message: `Plugin "${manifest.id}" declares AI capabilities (${aiCapabilities.join(', ')}) without the "ai" permission.`,
		});
	}

	if (engineRuntime === 'client' && (hasAiPermission || aiCapabilities.length > 0)) {
		violations.push({
			code: 'runtime-ai-disallowed',
			message: `Plugin "${manifest.id}" cannot run with AI capabilities/permissions in the client runtime.`,
		});
	}

	if (manifest.runtime === 'client' && hasAiPermission) {
		violations.push({
			code: 'client-runtime-ai-permission-disallowed',
			message: `Plugin "${manifest.id}" targets client runtime and cannot request the "ai" permission.`,
		});
	}

	return dedupeViolations(violations);
}

function usesAiCapability(capability: string): boolean {
	return /(^|:)ai($|:)/i.test(capability.trim());
}

function dedupeViolations(violations: PluginSecurityViolation[]): PluginSecurityViolation[] {
	const seen = new Set<string>();
	const unique: PluginSecurityViolation[] = [];

	for (const violation of violations) {
		const key = `${violation.code}:${violation.message}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		unique.push(violation);
	}

	return unique;
}

function evaluateComparator(comparator: string, version: string): boolean {
	if (comparator.startsWith('^')) {
		const floor = comparator.slice(1);
		return compareSemver(version, floor) >= 0 && sameMajor(version, floor);
	}

	if (comparator.startsWith('~')) {
		const floor = comparator.slice(1);
		return compareSemver(version, floor) >= 0 && sameMajorMinor(version, floor);
	}

	if (comparator.startsWith('>=')) {
		return compareSemver(version, comparator.slice(2)) >= 0;
	}

	if (comparator.startsWith('<=')) {
		return compareSemver(version, comparator.slice(2)) <= 0;
	}

	if (comparator.startsWith('>')) {
		return compareSemver(version, comparator.slice(1)) > 0;
	}

	if (comparator.startsWith('<')) {
		return compareSemver(version, comparator.slice(1)) < 0;
	}

	return compareSemver(version, comparator) === 0;
}

function sameMajor(left: string, right: string): boolean {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);
	return !!parsedLeft && !!parsedRight && parsedLeft.major === parsedRight.major;
}

function sameMajorMinor(left: string, right: string): boolean {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);
	return (
		!!parsedLeft &&
		!!parsedRight &&
		parsedLeft.major === parsedRight.major &&
		parsedLeft.minor === parsedRight.minor
	);
}

function compareSemver(left: string, right: string): number {
	const parsedLeft = parseSemver(left);
	const parsedRight = parseSemver(right);

	if (!parsedLeft || !parsedRight) {
		return 0;
	}

	if (parsedLeft.major !== parsedRight.major) {
		return parsedLeft.major - parsedRight.major;
	}

	if (parsedLeft.minor !== parsedRight.minor) {
		return parsedLeft.minor - parsedRight.minor;
	}

	if (parsedLeft.patch !== parsedRight.patch) {
		return parsedLeft.patch - parsedRight.patch;
	}

	return 0;
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | null {
	const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		return null;
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}
