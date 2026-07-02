import { toStringMaybe, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';

export type NpmPluginOptions = PlatformV0PluginOptions;

const NPM_PLUGIN_ID = 'npm';
const NPM_DESCRIPTION = 'npm package';

export const npmProfile: PlatformV0Profile = {
	domain: 'npm',
	supportsOEmbed: false,
	classifier: {
		id: 'npm-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseNpmPackageUrl(input);
			if (!parsed) {
				return null;
			}

			return {
				type: 'url' as const,
				domain: 'npm',
				subtype: 'package',
				confidence: 0.99,
				meta: {
					packageName: parsed.packageName,
					canonicalUrl: parsed.canonicalUrl,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		const packageName = toStringMaybe(classification.meta.packageName) ?? 'unknown-package';
		const canonicalPackageUrl = toStringMaybe(classification.meta.canonicalUrl) ?? canonicalUrl;
		const title = `${packageName} on npm`;

		return withPlatformMetadata(
			{
				schemaType: 'SoftwareSourceCode',
				category: 'software',
				title,
				description: NPM_DESCRIPTION,
				canonicalId: `npm:package:${packageName.toLowerCase()}`,
				sameAs: [canonicalPackageUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'SoftwareSourceCode',
					name: title,
					description: NPM_DESCRIPTION,
					identifier: packageName,
					url: canonicalPackageUrl,
					sameAs: [canonicalPackageUrl],
				},
			},
			'npm',
			classification.subtype,
			{
				pluginId: NPM_PLUGIN_ID,
				provider: 'npm',
				fetchedAt: now,
				sourceUrl: canonicalPackageUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createNpmPlugin(options: NpmPluginOptions = {}) {
	return createPlatformPlugin({
		pluginId: NPM_PLUGIN_ID,
		resolverId: 'npm-resolver',
		profile: npmProfile,
		options,
	});
}

function tryParseNpmPackageUrl(
	input: string
): { packageName: string; canonicalUrl: string } | null {
	let parsed: URL;
	try {
		parsed = new URL(input.trim());
	} catch {
		return null;
	}

	const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
	if (hostname !== 'npmjs.com' && hostname !== 'npmjs.org') {
		return null;
	}

	const segments = parsed.pathname.split('/').filter(Boolean);
	if (segments[0] !== 'package') {
		return null;
	}

	const packageName = readPackageName(segments.slice(1));
	if (!packageName) {
		return null;
	}

	return {
		packageName,
		canonicalUrl: buildCanonicalNpmUrl(packageName),
	};
}

function readPackageName(segments: string[]): string | undefined {
	const encodedFirst = segments[0];
	if (!encodedFirst) {
		return undefined;
	}

	const first = decodeURIComponent(encodedFirst);
	if (first.startsWith('@')) {
		const encodedSecond = segments[1];
		if (!encodedSecond) {
			return undefined;
		}

		return `${first}/${decodeURIComponent(encodedSecond)}`;
	}

	return first;
}

function buildCanonicalNpmUrl(packageName: string): string {
	const [scope, name] = packageName.split('/');
	if (scope && name) {
		return `https://www.npmjs.com/package/${encodeScopedSegment(scope)}/${encodeURIComponent(name)}`;
	}

	return `https://www.npmjs.com/package/${encodeURIComponent(packageName)}`;
}

function encodeScopedSegment(value: string): string {
	return encodeURIComponent(value).replace(/^%40/, '@');
}
