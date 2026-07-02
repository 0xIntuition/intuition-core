import type { DecisionContext, DecisionVariantId, RuleEvaluation } from '../types';

export type Rule = {
	id: DecisionVariantId;
	priority: number;
	match: (context: DecisionContext) => RuleEvaluation;
};

export function match(
	ruleId: DecisionVariantId,
	priority: number,
	reason: RuleEvaluation['reason'] = 'matched'
): RuleEvaluation {
	return {
		ruleId,
		priority,
		matched: true,
		reason,
	};
}

export function noMatch(
	ruleId: DecisionVariantId,
	priority: number,
	reason: RuleEvaluation['reason']
): RuleEvaluation {
	return {
		ruleId,
		priority,
		matched: false,
		reason,
	};
}
