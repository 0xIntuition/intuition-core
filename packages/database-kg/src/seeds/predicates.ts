/**
 * Baseline predicates for the knowledge graph.
 *
 * Canonical set of predicates that every deployment starts with. The seed
 * (`scripts/seed-predicates.ts`) is idempotent and uses
 * `ON CONFLICT (slug) DO NOTHING`.
 *
 * Public/protocol predicates that have a canonical stack-predicate definition
 * reuse that predicate's ipfs atom id as their `kg.predicates.id`. This
 * collapses the two parallel registries into a single id space for any
 * predicate that needs to be publicly addressable. Legacy `pred_*` slugs are
 * grandfathered. See
 * the enshrined-predicates architecture notes.
 */
// Resolved literal of TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID from
// the private @0xintuition/stacks package. Identity-sensitive: this is the
// canonical ipfs atom id for the enshrined stack predicate — do not change.
const TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID =
	'0x0840db4575bf6bdb49b66c21dc40cb4cbb5e1b26bd239d7f56b126c14e452c07';

export const BASELINE_PREDICATES = [
	{
		id: 'pred_references',
		slug: 'references',
		label: 'References',
		description: 'Subject references or cites the object.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_follows',
		slug: 'follows',
		label: 'Follows',
		description: 'Subject follows the object account.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: true,
		isMarket: false,
	},
	{
		id: TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID,
		slug: 'trusted-in-the-context-of',
		label: 'Trusted in the context of',
		description:
			'Subject (an account or atom) is trusted in the context of the object (a category atom). Truster identity is captured separately as off-chain deposit/stake statements that reference the resulting triple.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: true,
		isMarket: false,
	},
	{
		id: 'pred_is_about',
		slug: 'is-about',
		label: 'Is About',
		description: 'Subject is about or concerns the object topic.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_has_tag',
		slug: 'has-tag',
		label: 'Has Tag',
		description: 'Subject is tagged with the object concept.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_created_by',
		slug: 'created-by',
		label: 'Created By',
		description: 'Subject was created by the object account.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_member_of',
		slug: 'member-of',
		label: 'Member Of',
		description: 'Subject is a member of the object collection or group.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: true,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_part_of',
		slug: 'part-of',
		label: 'Part Of',
		description: 'Subject is a part or component of the object.',
		isTransitive: true,
		isSymmetric: false,
		isHierarchical: true,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_related_to',
		slug: 'related-to',
		label: 'Related To',
		description: 'Subject is related to the object in a general sense.',
		isTransitive: false,
		isSymmetric: true,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_deposited_in',
		slug: 'deposited-in',
		label: 'Deposited In',
		description: 'Subject deposited assets in the object vault.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: true,
	},
	{
		id: 'pred_staked_on',
		slug: 'staked-on',
		label: 'Staked On',
		description: 'Subject staked conviction on the object claim.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: false,
		isMarket: true,
	},
	{
		id: 'pred_endorsed',
		slug: 'endorsed',
		label: 'Endorsed',
		description: 'Subject endorsed or vouched for the object entity.',
		isTransitive: false,
		isSymmetric: false,
		isHierarchical: false,
		isSocial: true,
		isMarket: false,
	},
	{
		id: 'pred_similar_to',
		slug: 'similar-to',
		label: 'Similar To',
		description: 'Subject is semantically similar to the object.',
		isTransitive: false,
		isSymmetric: true,
		isHierarchical: false,
		isSocial: false,
		isMarket: false,
	},
	{
		id: 'pred_subcategory_of',
		slug: 'subcategory-of',
		label: 'Subcategory Of',
		description: 'Subject is a subcategory or subtype of the object.',
		isTransitive: true,
		isSymmetric: false,
		isHierarchical: true,
		isSocial: false,
		isMarket: false,
	},
] as const;

export type BaselinePredicate = (typeof BASELINE_PREDICATES)[number];

/** Canonical predicate IDs derived from BASELINE_PREDICATES — use these instead of magic strings. */
export const PREDICATE_IDS = {
	REFERENCES: 'pred_references',
	FOLLOWS: 'pred_follows',
	TRUSTED_IN_THE_CONTEXT_OF: TRUSTED_IN_THE_CONTEXT_OF_STACK_PREDICATE_IPFS_ATOM_ID,
	IS_ABOUT: 'pred_is_about',
	HAS_TAG: 'pred_has_tag',
	CREATED_BY: 'pred_created_by',
	MEMBER_OF: 'pred_member_of',
	PART_OF: 'pred_part_of',
	RELATED_TO: 'pred_related_to',
	DEPOSITED_IN: 'pred_deposited_in',
	STAKED_ON: 'pred_staked_on',
	ENDORSED: 'pred_endorsed',
	SIMILAR_TO: 'pred_similar_to',
	SUBCATEGORY_OF: 'pred_subcategory_of',
} as const satisfies Record<string, BaselinePredicate['id']>;
