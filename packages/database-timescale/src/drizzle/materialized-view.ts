import { type PgColumnBuilderBase, pgMaterializedView } from 'drizzle-orm/pg-core';

// Workspace-local adapter pinned to drizzle-orm@0.45.1.
// This keeps materialized-view usage behind a stable package surface.
export const defineExistingTimescaleMaterializedView = <
	const TName extends string,
	TColumns extends Record<string, PgColumnBuilderBase>,
>(
	name: TName,
	columns: TColumns
) => {
	return pgMaterializedView(name, columns).existing();
};
