# Publishable Boundary

`resolved.classifications` can remain rich and presentation-friendly. `resolved.publishable`
is the identity-focused payload used for publishing, so it should avoid mutable media
and presentation fields.

## Keep publishable

- Stable names and identifiers: `name`, `identifier`, `alternateName`
- Stable URLs: `url`, `contentUrl`, `canonicalUrl`, `sameAs`
- Domain identity fields: `brand`, `sku`, `gtin`, `isbn`, `termCode`, `address`,
  `chainId`, `username`, `platform`
- Text only when the text is the identity of the object, such as an X post

## Keep off publishable

- Product images, profile avatars, thumbnails, logos, and social media attachments
- Mutable commerce state such as offers, prices, ratings, reviews, and availability
- Rich presentation data that belongs in enrichment artifacts

The frontend should render rich cards from enrichment artifacts and the atom rules engine,
not from image-bearing fields in `resolved.publishable`.
