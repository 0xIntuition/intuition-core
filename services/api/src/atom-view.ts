export type AtomRawView = {
	type: string;
	data: string | null;
	dataHex?: string | null;
};

export type AtomIdentityView = {
	raw: string | null;
	canonical: string | null;
	profile?: 'p0' | 'p1' | 'p2';
	scheme?: string;
	value?: string;
	class?: 'A' | 'B' | 'C';
	typing?: 'unambiguous' | 'polymorphic';
	anchorIneligibilityReason?: 'class-c' | 'polymorphic-scheme';
	valid?: boolean;
	anchorEligible?: boolean;
	provenance?: {
		producer: string;
		version: string;
		specificationVersion?: string;
	};
};

export type AtomClassificationView = {
	type: string;
	status?: string;
	source?: string;
};

export type AtomContextView = {
	eventSequence?: string;
	ordinal: number;
	uri: string | null;
	source?: string;
	raw?: string;
	registrant?: string;
	transactionHash?: string;
	logIndex?: number;
};

export type PersistedAtomContextSource = {
	eventSequence: bigint;
	ordinal: number;
	uriText: string | null;
	uriHex: string;
	registrant: string;
	transactionHash: string;
	logIndex: number;
};

export type AtomResolutionView = {
	status: string;
	updatedAt?: Date | string | null;
};

export type AtomDisplayView = {
	name?: string;
	description?: string;
	image?: string;
};

export type AtomViewFields = {
	raw: AtomRawView;
	identity?: AtomIdentityView;
	classification: AtomClassificationView;
	context?: AtomContextView[];
	resolution?: AtomResolutionView;
	display?: AtomDisplayView;
};

export type AtomViewSource = {
	rawType: string;
	data: string | null;
	dataHex?: string | null;
	iid?: string | null;
	dataResolved?: unknown;
	parseResult?: unknown;
	classificationType: string;
	classificationStatus?: string;
	classificationResult?: unknown;
	enrichmentStatus?: string;
	enrichmentError?: unknown;
	enrichedAt?: Date | string | null;
	context?: readonly AtomContextView[];
};

const LIST_INTERNAL_EVIDENCE = [
	'parseResult',
	'classificationResult',
	'enrichmentError',
	'enrichedAt',
] as const;

/**
 * List queries select additional evidence to build the semantic envelope. Do
 * not expose those database fields until the additive response is enabled.
 */
export function exposeAtomListView<T extends AtomViewSource>(atom: T, enabled: boolean) {
	if (enabled) {
		return omitFields(presentAtom(atom), LIST_INTERNAL_EVIDENCE);
	}
	return omitFields(atom, ['iid', ...LIST_INTERNAL_EVIDENCE] as const);
}

/**
 * Detail queries historically exposed the full node row. Persisted `iid` and
 * joined context were added later and remain hidden on the legacy path.
 */
export function exposeAtomDetailView<T extends AtomViewSource>(atom: T, enabled: boolean) {
	return enabled ? presentAtom(atom) : omitFields(atom, ['iid', 'context'] as const);
}

/** Map storage evidence without decoding, normalizing, sorting, or deduplicating it. */
export function presentPersistedAtomContext(context: PersistedAtomContextSource): AtomContextView {
	return {
		eventSequence: context.eventSequence.toString(),
		ordinal: context.ordinal,
		uri: context.uriText,
		source: 'onchain',
		raw: context.uriHex,
		registrant: context.registrant,
		transactionHash: context.transactionHash,
		logIndex: context.logIndex,
	};
}

/** Return the byte-for-byte legacy object shape while exposure is disabled. */
export function exposeAtomView<T extends AtomViewSource>(atom: T, enabled: false): T;
export function exposeAtomView<T extends AtomViewSource>(
	atom: T,
	enabled: true
): T & AtomViewFields;
export function exposeAtomView<T extends AtomViewSource>(
	atom: T,
	enabled: boolean
): T | (T & AtomViewFields);
export function exposeAtomView<T extends AtomViewSource>(
	atom: T,
	enabled: boolean
): T | (T & AtomViewFields) {
	return enabled ? presentAtom(atom) : atom;
}

export type ExpandedAtomTermSource = AtomViewSource & { id: string };

/**
 * Expanded triple terms historically contain exactly four fields. The query
 * also selects resolved data for the optional display view, but that internal
 * input must not leak while exposure is disabled.
 */
export function exposeExpandedAtomTerm<T extends ExpandedAtomTermSource>(
	term: T,
	enabled: boolean
) {
	if (enabled) {
		return presentAtom(term);
	}

	return {
		id: term.id,
		data: term.data,
		classificationType: term.classificationType,
		rawType: term.rawType,
	};
}

/**
 * Add the stable atom presentation envelope without removing or renaming any
 * database-shaped fields. Optional sections are omitted until their evidence
 * exists; in particular, an absent context reader must not look like an atom
 * with a proven empty context list.
 */
export function presentAtom<T extends AtomViewSource>(atom: T): T & AtomViewFields {
	const identity = resolveIdentity(atom);
	const display = resolveDisplay(atom.dataResolved);
	const classificationSource = readString(toRecord(atom.classificationResult)?.source);

	return {
		...atom,
		raw: {
			type: atom.rawType,
			data: atom.data,
			...(atom.dataHex !== undefined ? { dataHex: atom.dataHex } : {}),
		},
		...(identity ? { identity } : {}),
		classification: {
			type: atom.classificationType,
			...(atom.classificationStatus ? { status: atom.classificationStatus } : {}),
			...(classificationSource ? { source: classificationSource } : {}),
		},
		...(atom.context !== undefined ? { context: [...atom.context] } : {}),
		...(atom.enrichmentStatus
			? {
					resolution: {
						status: normalizeResolutionStatus(atom.enrichmentStatus, atom.enrichmentError),
						...(atom.enrichedAt !== undefined ? { updatedAt: atom.enrichedAt } : {}),
					},
				}
			: {}),
		...(display ? { display } : {}),
	};
}

function resolveIdentity(atom: AtomViewSource): AtomIdentityView | undefined {
	const parseResult = toRecord(atom.parseResult);
	if (parseResult?.kind === 'iid') {
		const nestedIdentity = resolveNestedIdentity(parseResult.identity);
		if (nestedIdentity) {
			return nestedIdentity;
		}
	}

	const persistedIid = atom.rawType === 'iid' ? readString(atom.iid) : undefined;
	if (persistedIid) {
		return {
			raw: atom.data,
			canonical: persistedIid,
		};
	}

	if (parseResult?.kind !== 'iid') {
		return undefined;
	}

	const canonical =
		readString(parseResult.canonicalIid) ?? readString(parseResult.canonicalId) ?? null;
	const raw = atom.data ?? readString(parseResult.normalizedInput) ?? null;
	const profile = readIdentityProfile(parseResult.profile);
	const scheme = readString(parseResult.scheme);
	const value = readString(parseResult.value);
	const identityClass = readIdentityClass(parseResult.class);
	const typing = readIdentityTyping(parseResult.typing);
	const anchorIneligibilityReason = readAnchorIneligibilityReason(
		parseResult.anchorIneligibilityReason
	);
	const anchorEligible = parseResult.anchorEligible;
	const provenance = resolveIdentityProvenance(parseResult.provenance);

	return {
		raw,
		canonical,
		...(profile ? { profile } : {}),
		...(scheme ? { scheme } : {}),
		...(value ? { value } : {}),
		...(identityClass ? { class: identityClass } : {}),
		...(typing ? { typing } : {}),
		...(anchorIneligibilityReason ? { anchorIneligibilityReason } : {}),
		...(typeof parseResult.valid === 'boolean' ? { valid: parseResult.valid } : {}),
		...(typeof anchorEligible === 'boolean' ? { anchorEligible } : {}),
		...(provenance ? { provenance } : {}),
	};
}

function resolveNestedIdentity(value: unknown): AtomIdentityView | undefined {
	const identity = toRecord(value);
	if (!identity) {
		return undefined;
	}

	const raw = readString(identity.raw);
	const canonical = readString(identity.canonical);
	const scheme = readString(identity.scheme);
	const identityValue = readString(identity.value);
	if (
		!raw ||
		!canonical ||
		!scheme ||
		!identityValue ||
		typeof identity.anchorEligible !== 'boolean'
	) {
		return undefined;
	}

	const profile = readIdentityProfile(identity.profile);
	const identityClass = readIdentityClass(identity.class);
	const typing = readIdentityTyping(identity.typing);
	const anchorIneligibilityReason = readAnchorIneligibilityReason(
		identity.anchorIneligibilityReason
	);
	const provenance = resolveIdentityProvenance(identity.provenance);
	return {
		raw,
		canonical,
		...(profile ? { profile } : {}),
		scheme,
		value: identityValue,
		...(identityClass ? { class: identityClass } : {}),
		...(typing ? { typing } : {}),
		...(anchorIneligibilityReason ? { anchorIneligibilityReason } : {}),
		...(typeof identity.valid === 'boolean' ? { valid: identity.valid } : {}),
		anchorEligible: identity.anchorEligible,
		...(provenance ? { provenance } : {}),
	};
}

function resolveIdentityProvenance(
	value: unknown
): NonNullable<AtomIdentityView['provenance']> | undefined {
	const provenance = toRecord(value);
	const producer = readString(provenance?.producer);
	const version = readString(provenance?.version);
	if (!producer || !version) {
		return undefined;
	}

	const specificationVersion = readString(provenance?.specificationVersion);
	return {
		producer,
		version,
		...(specificationVersion ? { specificationVersion } : {}),
	};
}

function readIdentityProfile(value: unknown): AtomIdentityView['profile'] {
	return value === 'p0' || value === 'p1' || value === 'p2' ? value : undefined;
}

function readIdentityClass(value: unknown): AtomIdentityView['class'] {
	return value === 'A' || value === 'B' || value === 'C' ? value : undefined;
}

function readIdentityTyping(value: unknown): AtomIdentityView['typing'] {
	return value === 'unambiguous' || value === 'polymorphic' ? value : undefined;
}

function readAnchorIneligibilityReason(
	value: unknown
): AtomIdentityView['anchorIneligibilityReason'] {
	return value === 'class-c' || value === 'polymorphic-scheme' ? value : undefined;
}

function resolveDisplay(value: unknown): AtomDisplayView | undefined {
	const root = toRecord(value);
	if (!root) {
		return undefined;
	}

	const candidates = [root, toRecord(root.resolvedAtom), toRecord(root.data)].filter(
		(value): value is Record<string, unknown> => value !== undefined
	);
	const name = firstString(candidates, ['name', 'title', 'displayName', 'headline']);
	const description = firstString(candidates, ['description', 'summary']);
	const image = firstImage(candidates);

	if (!name && !description && !image) {
		return undefined;
	}

	return {
		...(name ? { name } : {}),
		...(description ? { description } : {}),
		...(image ? { image } : {}),
	};
}

function normalizeResolutionStatus(status: string, error: unknown): string {
	if (status === 'completed') {
		return 'resolved';
	}
	if (status === 'failed') {
		const retriable = toRecord(error)?.retriable;
		if (retriable === true) {
			return 'retryable';
		}
		if (retriable === false) {
			return 'terminal';
		}
	}
	return status;
}

function firstString(
	records: ReadonlyArray<Record<string, unknown>>,
	fields: readonly string[]
): string | undefined {
	for (const record of records) {
		for (const field of fields) {
			const value = readString(record[field]);
			if (value) {
				return value;
			}
		}
	}
	return undefined;
}

function firstImage(records: ReadonlyArray<Record<string, unknown>>): string | undefined {
	const fields = [
		'image',
		'imageUrl',
		'image_url',
		'thumbnailUrl',
		'thumbnail',
		'avatarUrl',
		'profileImageUrl',
		'logo',
	] as const;

	for (const record of records) {
		for (const field of fields) {
			const value = record[field];
			const direct = readString(value);
			if (direct) {
				return direct;
			}
			const nested = toRecord(value);
			const nestedUrl = readString(nested?.url) ?? readString(nested?.contentUrl);
			if (nestedUrl) {
				return nestedUrl;
			}
		}
	}
	return undefined;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function omitFields<T extends object, const K extends readonly PropertyKey[]>(
	value: T,
	keys: K
): Omit<T, K[number]> {
	const result = { ...value };
	for (const key of keys) {
		delete (result as Record<PropertyKey, unknown>)[key];
	}
	return result;
}

function readString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) {
		return value.trim();
	}
	if (Array.isArray(value)) {
		return value.map(readString).find((entry): entry is string => entry !== undefined);
	}
	return undefined;
}
