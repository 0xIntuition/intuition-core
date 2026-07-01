// Intuition Core — knowledge-graph schema.
//
// The graph core: nodes (atoms), triples (claims), accounts, predicates,
// artifacts, node_urls, adjacency, events, and their stats tables.
//
// The social/product layer (stacks, perspectives, communities, posts, comments,
// follows), the recommendation/search schemas, and the auth bridge live in the
// private monorepo and are intentionally excluded here. Protocol market and
// projection schemas will be layered in as follow-on slices.

export * from './schemas/kg';
