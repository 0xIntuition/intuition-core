import { normalizePersistedArtifacts, normalizeProcessArtifacts } from './context-artifacts';
import { resolveIdentity } from './context-identity';
import { parseJsonRecord, readString, toRecord } from './context-utils';
import type {
	ClassificationResultInput,
	DecisionContext,
	PersistedAtomInput,
	ProcessPayloadInput,
} from './types';

export function buildDecisionContextFromPersistedAtom(atom: PersistedAtomInput): DecisionContext {
	const parsedAtomData = parseJsonRecord(atom.data);
	const structuredData = toRecord(atom.parse_result?.structuredDocument?.data);
	const classificationResult = atom.classification_result ?? null;
	const artifacts = atom.canonicalArtifacts ?? normalizePersistedArtifacts(atom.artifacts ?? []);
	const identity = resolveIdentity({
		atomData: atom.data,
		parsedAtomData,
		structuredData,
		classificationResult,
		artifacts,
	});

	return {
		source: 'persisted-atom',
		atomData: atom.data,
		parsedAtomData,
		structuredData,
		classificationResult,
		identity,
		artifacts,
	};
}

export function buildDecisionContextFromProcessPayload(input: {
	processPayload: ProcessPayloadInput | null | undefined;
	rawInput: string;
	derivedAtomData?: string;
}): DecisionContext {
	const payload = input.processPayload;
	const resolvedAtom = payload?.classification?.resolved?.atoms?.[0];
	const publishable =
		payload?.classification?.resolved?.publishable?.[0] ??
		payload?.classification?.resolved?.classifications?.[0];

	const parsedDerivedAtomData = parseJsonRecord(input.derivedAtomData);
	const structuredData = toRecord(publishable?.data) ?? parsedDerivedAtomData;
	const artifacts = normalizeProcessArtifacts(payload?.enrichment?.artifacts ?? []);
	const classificationResult = {
		category: resolvedAtom?.category,
		schemaType: resolvedAtom?.schemaType,
		targetUrl:
			readString(publishable?.meta?.sourceUrl) ??
			readString(publishable?.data?.url) ??
			readString(resolvedAtom?.canonicalId),
	} satisfies ClassificationResultInput;

	const identity = resolveIdentity({
		atomData: input.derivedAtomData,
		parsedAtomData: parsedDerivedAtomData,
		structuredData,
		classificationResult,
		resolvedAtom,
		rawInput: input.rawInput,
		artifacts,
	});

	return {
		source: 'process-payload',
		rawInput: input.rawInput,
		derivedAtomData: input.derivedAtomData,
		atomData: input.derivedAtomData,
		parsedAtomData: parsedDerivedAtomData,
		structuredData,
		classificationResult,
		identity,
		artifacts,
	};
}

export {
	findArtifact,
	isAmazonUrl,
	isAppleMusicUrl,
	isEtherscanUrl,
	isHttpUrl,
	isNpmUrl,
	isTmdbUrl,
	isWikipediaUrl,
	isXUrl,
	isYouTubeUrl,
	parseJsonRecord,
	readString,
	toRecord,
} from './context-utils';
