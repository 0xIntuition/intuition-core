# JSON-LD Type Registration and Collision Policy

## Registration contract

Use the shared helpers from `@0xintuition/atom-classification`:

- `jsonLdTypeDefinitionSchema`
- `registerTypeOptionsSchema`
- `validateJsonLdTypeDefinition()`
- `validateRegisterTypeOptions()`

A type definition includes:

- `type`
- `aliases` (optional)
- `category`
- `schema` (Zod schema)
- `requiredFields`
- `recommendedFields`
- `identityFields`

In `cpkg-02`, canonical resolver output is validated against the registered
schema using `classification.data`:

- `resolved.classifications[n].type` must be registered
- `resolved.classifications[n].data` must pass the registered schema
- compatibility `resolved.atoms` is projected from canonical output and parity
  checked in engine runtime

## Collision policy

Default behavior:

- Registering the same `type` twice throws an error.

Override behavior:

- Pass `{ allowOverride: true }` to replace an existing type definition.
- Overrides should be intentional and versioned in plugin release notes.

## Recommended practice for external plugins

1. Prefer unique type ownership in one plugin.
2. Only override when you control deployment order and compatibility.
3. Add integration tests that assert resolved payloads still validate against
   the final registered type schema.
