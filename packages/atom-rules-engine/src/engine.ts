import {
	buildDecisionContextFromPersistedAtom,
	buildDecisionContextFromProcessPayload,
} from './context';
import { rules } from './rules';
import { match } from './rules/shared';
import type {
	AtomDecisionResult,
	DecisionContext,
	DecisionTrace,
	PersistedAtomInput,
	ProcessPayloadInput,
} from './types';

export function resolveDecisionFromPersistedAtom(atom: PersistedAtomInput): AtomDecisionResult {
	const context = buildDecisionContextFromPersistedAtom(atom);
	return resolveDecision(context);
}

export function resolveDecisionFromProcessPayload(input: {
	processPayload: ProcessPayloadInput | null | undefined;
	rawInput: string;
	derivedAtomData?: string;
}): AtomDecisionResult {
	const context = buildDecisionContextFromProcessPayload(input);
	return resolveDecision(context);
}

export function resolveDecision(context: DecisionContext): AtomDecisionResult {
	const evaluations = rules
		.map((rule) => rule.match(context))
		.sort((left, right) => right.priority - left.priority);
	const selected =
		evaluations.find((evaluation) => evaluation.matched) ?? match('generic', 10, 'fallback');
	const trace: DecisionTrace = {
		artifactSlugs: context.artifacts.map((artifact) => artifact.slug),
		identity: context.identity,
		evaluations,
		selectedRuleId: selected.ruleId,
	};

	return {
		variantId: selected.ruleId,
		context,
		trace,
	};
}
