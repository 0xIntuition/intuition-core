import { WorkerConfigurationError } from '../shared/errors';
import type { IdentityRungProjection, NormalizedAtomIdentity } from './identity-contract';
import type { IidInspectionAdapter } from './iid-inspection';

/** Structural public package interface; policy values stay in the injected module. */
export type PublicIidLadderModule = {
	IDENTITY_CATEGORY_RUNG_POLICY: Readonly<Partial<Record<string, readonly string[]>>>;
	IDENTITY_CATEGORY_ALIAS_ONLY_POLICY: Readonly<Partial<Record<string, readonly string[]>>>;
	SCHEMA_TYPE_IDENTITY_CATEGORIES: Readonly<Partial<Record<string, string>>>;
	identityRungsForCategory(category: string): readonly string[];
	iidForIdentityRung(rung: string, value: string, schemaType?: string): string | undefined;
	isPlainWdPrimaryAllowed(schemaType?: string): boolean;
	projectIdentifierLadder(input: {
		providerCanonicalId?: string;
		canonicalUrl?: string;
		allowPlainWd?: boolean;
	}): { iid: string | null; rung?: string };
};

export type IdentityRungInput = {
	identity?: NormalizedAtomIdentity;
	schemaType?: string;
	category?: string;
	providerCanonicalId?: string;
	canonicalUrl?: string;
	identifiers?: Record<string, string>;
};

export type IidLadderAdapter = {
	projectIdentityRungs(input: IdentityRungInput): IdentityRungProjection;
	isPlainWdPrimaryAllowed(schemaType?: string): boolean;
};

export function createIidLadderAdapter(
	module: PublicIidLadderModule & { packageVersion: string },
	inspection: Pick<IidInspectionAdapter, 'inspect'>
): IidLadderAdapter {
	const version = module.packageVersion.trim();
	if (!version)
		throw new WorkerConfigurationError(
			'@0xintuition/iid-ladder adapter requires an exact version.'
		);
	return {
		isPlainWdPrimaryAllowed: (schemaType) => module.isPlainWdPrimaryAllowed(schemaType),
		projectIdentityRungs(input) {
			// Registry/plugin categories may be broad (Media/thing). Only a package
			// policy category overrides the package's schema-to-category mapping.
			const category =
				input.category && Object.hasOwn(module.IDENTITY_CATEGORY_RUNG_POLICY, input.category)
					? input.category
					: input.schemaType &&
							Object.hasOwn(module.SCHEMA_TYPE_IDENTITY_CATEGORIES, input.schemaType)
						? module.SCHEMA_TYPE_IDENTITY_CATEGORIES[input.schemaType]
						: input.category;
			const hasPolicy = !!category && Object.hasOwn(module.IDENTITY_CATEGORY_RUNG_POLICY, category);
			const policy = hasPolicy ? (module.IDENTITY_CATEGORY_RUNG_POLICY[category] ?? []) : [];
			const aliases =
				category && Object.hasOwn(module.IDENTITY_CATEGORY_ALIAS_ONLY_POLICY, category)
					? (module.IDENTITY_CATEGORY_ALIAS_ONLY_POLICY[category] ?? [])
					: [];
			const allowedPlainWd = module.isPlainWdPrimaryAllowed(input.schemaType);
			// Generic ladder labels (strong/handle) do not identify a scheme or
			// establish category admission. Inspect every canonical candidate using
			// the injected IID package, including historical identities.
			const inspectRung = (iid: string) => {
				const inspected = inspection.inspect(iid);
				if (!inspected.valid || inspected.scheme === 'url') return undefined;
				const aliasRung = aliases.find(
					(rung) =>
						rung === inspected.scheme ||
						module.iidForIdentityRung(rung, inspected.value, input.schemaType) === iid
				);
				return { inspected, aliasRung };
			};
			const isPrimaryAllowed = (candidate: NonNullable<ReturnType<typeof inspectRung>>) =>
				!candidate.aliasRung &&
				(candidate.inspected.scheme !== 'wd' ||
					candidate.inspected.typing !== 'polymorphic' ||
					allowedPlainWd);
			const rungs: IdentityRungProjection['rungs'] = [];
			for (const rung of hasPolicy ? module.identityRungsForCategory(category) : []) {
				const value =
					input.identifiers && Object.hasOwn(input.identifiers, rung)
						? input.identifiers[rung]
						: undefined;
				if (!value?.trim()) continue;
				const iid = module.iidForIdentityRung(rung, value, input.schemaType);
				if (iid && inspection.inspect(iid).scheme === 'url') continue;
				rungs.push({ rung, value, ...(iid ? { iid } : {}), aliasOnly: aliases.includes(rung) });
			}
			let primary: IdentityRungProjection['primary'];
			const identityRung = input.identity ? inspectRung(input.identity.canonical) : undefined;
			if (input.identity && identityRung) {
				const rung = identityRung.aliasRung ?? identityRung.inspected.scheme;
				if (isPrimaryAllowed(identityRung)) primary = { rung, iid: input.identity.canonical };
				if (!rungs.some((entry) => entry.iid === input.identity?.canonical)) {
					rungs.unshift({
						rung,
						value: identityRung.inspected.value,
						iid: input.identity.canonical,
						aliasOnly: !!identityRung.aliasRung,
					});
				}
			}
			if (!primary) {
				for (const rung of policy) {
					if (aliases.includes(rung)) continue;
					const candidate = rungs.find((entry) => entry.rung === rung && entry.iid);
					const inspected = candidate?.iid ? inspectRung(candidate.iid) : undefined;
					if (candidate?.iid && inspected && isPrimaryAllowed(inspected)) {
						primary = { rung, iid: candidate.iid };
						break;
					}
				}
			}
			for (const fallback of [
				{ providerCanonicalId: input.providerCanonicalId },
				{ canonicalUrl: input.canonicalUrl },
			]) {
				if (primary) break;
				const result = module.projectIdentifierLadder({
					...fallback,
					allowPlainWd: allowedPlainWd,
				});
				if (!result.iid || !result.rung || result.rung === 'url') continue;
				const candidate = inspectRung(result.iid);
				if (!candidate) continue;
				const rung = candidate.aliasRung ?? result.rung;
				if (!rungs.some((entry) => entry.iid === result.iid)) {
					rungs.push({
						rung,
						value: fallback.providerCanonicalId ?? fallback.canonicalUrl ?? result.iid,
						iid: result.iid,
						aliasOnly: !!candidate.aliasRung,
					});
				}
				if (isPrimaryAllowed(candidate)) primary = { rung: result.rung, iid: result.iid };
			}
			return {
				...(category ? { category } : {}),
				...(primary ? { primary } : {}),
				rungs,
				provenance: {
					producer:
						'@0xintuition/iid-ladder/identityRungsForCategory+iidForIdentityRung+projectIdentifierLadder',
					version,
				},
			};
		},
	};
}
