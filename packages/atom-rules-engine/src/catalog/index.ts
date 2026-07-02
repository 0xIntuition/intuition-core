import type { DecisionVariantId } from '../types';
import {
	commerceRuleDocs,
	fallbackRuleDocs,
	identityRuleDocs,
	mediaRuleDocs,
	onchainRuleDocs,
	socialRuleDocs,
	softwareRuleDocs,
} from './groups';
import type { RuleDocSnippet } from './types';

export type { RuleDocSnippet } from './types';

export const orderedRuleDocSnippets = [
	...socialRuleDocs,
	...mediaRuleDocs,
	...softwareRuleDocs,
	...commerceRuleDocs,
	...onchainRuleDocs,
	...identityRuleDocs,
	...fallbackRuleDocs,
] as const satisfies readonly RuleDocSnippet[];

export const ruleDocSnippets = orderedRuleDocSnippets.reduce<
	Partial<Record<DecisionVariantId, RuleDocSnippet>>
>((accumulator, snippet) => {
	accumulator[snippet.variantId] = snippet;
	return accumulator;
}, {}) as Record<DecisionVariantId, RuleDocSnippet>;

export function getRuleDocSnippet(variantId: DecisionVariantId): RuleDocSnippet {
	return ruleDocSnippets[variantId];
}
