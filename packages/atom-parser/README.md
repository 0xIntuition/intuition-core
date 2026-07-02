# @0xintuition/atom-parser

Classifies and normalizes arbitrary string inputs into structured types. Detects IPFS URIs, Ethereum addresses, ENS names, JSON, URLs, ISBNs, and plain strings. Remote content inspection is enabled by default for URLs and IPFS URIs.

## Installation

```bash
bun add @0xintuition/atom-parser
```

## Quick Start

```typescript
import { parseAtom } from '@0xintuition/atom-parser/parse'

const result = await parseAtom('vitalik.eth')
// {
//   input: 'vitalik.eth',
//   normalizedInput: 'vitalik.eth',
//   kind: 'ens_name',
//   name: 'vitalik.eth',
//   warnings: []
// }
```

All kind-specific fields are at the top level — no nesting required.

## Imports

```typescript
import { parseAtom } from '@0xintuition/atom-parser/parse'        // Main entry point
import { detectLocal } from '@0xintuition/atom-parser/detect'      // Local detection only
import { inspectRemote } from '@0xintuition/atom-parser/remote'    // Remote inspection
import type { ParseResult, ParseOptions } from '@0xintuition/atom-parser/types'
```

## Detected Kinds

Inputs are classified in the following priority order:

| Kind                | Example Input                              | Description                                  |
| ------------------- | ------------------------------------------ | -------------------------------------------- |
| `ipfs`              | `ipfs://bafybei...`                        | IPFS URIs (`ipfs://` or `/ipfs/`) with valid CID |
| `ethereum_address`  | `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045` | 42-character hex address                  |
| `ens_name`          | `vitalik.eth`                              | ENS domain names ending in `.eth`            |
| `json`              | `{"key":"value"}`                          | Valid JSON objects or arrays                 |
| `url`               | `https://example.com`                      | Parseable URLs                               |
| `isbn`              | `978-0-306-40615-7`                        | ISBN-10 or ISBN-13 with valid checksum       |
| `plain_string`      | `hello world`                              | Anything that doesn't match above            |

## Examples

### Ethereum Address

```typescript
const result = await parseAtom('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
// {
//   input: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
//   normalizedInput: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
//   kind: 'ethereum_address',
//   address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
//   checksumAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
//   warnings: []
// }
```

### IPFS URI

```typescript
const result = await parseAtom(
  'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e/metadata/item.json',
  { ipfsGatewayBaseUrl: 'https://ipfs.io/' }
)
// {
//   kind: 'ipfs',
//   subtype: 'json_document',           // from remote inspection (on by default)
//   cid: 'bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e',
//   canonicalUri: 'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e/metadata/item.json',
//   path: 'metadata/item.json',
//   gatewayUrl: 'https://ipfs.io/ipfs/bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e/metadata/item.json',
//   remote: { outcome: 'success', subtype: 'json_document', ... },
//   ...
// }
```

Without a gateway configured, `gatewayUrl` is `undefined` and remote inspection is skipped:

```typescript
const result = await parseAtom('ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e')
// result.gatewayUrl === undefined
// result.remote?.outcome === 'skipped'
```

### URL with Remote Inspection

Remote inspection is on by default. The `subtype` is promoted to the top level:

```typescript
const result = await parseAtom('https://example.com')
// {
//   kind: 'url',
//   subtype: 'webpage',                 // immediately visible
//   canonicalUrl: 'https://example.com/',
//   scheme: 'https',
//   host: 'example.com',
//   path: '/',
//   hasQuery: false,
//   remote: { outcome: 'success', statusCode: 200, contentType: 'text/html', ... },
//   warnings: []
// }
```

To skip remote inspection:

```typescript
const result = await parseAtom('https://example.com', { remoteFetch: false })
// result.subtype === undefined
// result.remote === undefined
```

### JSON

```typescript
const result = await parseAtom('{"url":"https://example.com"}')
// {
//   kind: 'json',
//   topLevelType: 'object',
//   objectKeyCount: 1,
//   arrayLength: undefined,
//   ...
// }

const arr = await parseAtom('["https://example.com",42]')
// {
//   kind: 'json',
//   topLevelType: 'array',
//   objectKeyCount: undefined,
//   arrayLength: 2,
//   ...
// }
```

JSON scalars (`"string"`, `123`, `true`, `null`) are **not** detected as JSON — they fall through to `plain_string`.

### ISBN

```typescript
const result = await parseAtom('978-0-306-40615-7')
// {
//   kind: 'isbn',
//   canonical: '9780306406157',
//   format: 'isbn13',
//   checksumValid: true,
//   ...
// }

const isbn10 = await parseAtom('155860832X')
// {
//   kind: 'isbn',
//   canonical: '155860832X',
//   format: 'isbn10',
//   checksumValid: true,
//   ...
// }
```

### Plain String

Any input that doesn't match the above kinds falls back to `plain_string`:

```typescript
const result = await parseAtom('  hello world  ')
// {
//   kind: 'plain_string',
//   original: '  hello world  ',
//   trimmed: 'hello world',
//   ...
// }
```

## Result Structure

`ParseResult` is a **discriminated union on `kind`**. TypeScript narrows the type automatically:

```typescript
const result = await parseAtom(input)

if (result.kind === 'url') {
  result.subtype    // RemoteContentKind | undefined
  result.scheme     // string
  result.host       // string | undefined
}

if (result.kind === 'ipfs') {
  result.subtype    // RemoteContentKind | undefined
  result.cid        // string
  result.gatewayUrl // string | undefined
}

if (result.kind === 'ethereum_address') {
  result.checksumAddress // string
}
```

Only `url` and `ipfs` results have `subtype` and `remote` fields. Other kinds don't have remote inspection.

### Remote Content Subtypes

| Subtype           | Detected By                                       |
| ----------------- | ------------------------------------------------- |
| `webpage`         | `text/html` content type or HTML in body          |
| `json_document`   | `application/json` content type or valid JSON body |
| `image`           | `image/*` content type or PNG/JPEG/GIF magic bytes |
| `video`           | `video/*` content type or MP4 magic bytes         |
| `audio`           | `audio/*` content type or RIFF/ID3 magic bytes    |
| `generic_file`    | Known content type but not one of the above       |
| `unknown_remote`  | Empty body, no content type clues                 |

### Remote Outcomes

| Outcome                    | Meaning                                              |
| -------------------------- | ---------------------------------------------------- |
| `success`                  | Fetched and classified successfully                  |
| `skipped`                  | Skipped (e.g., no IPFS gateway configured)           |
| `denied`                   | Blocked by security policy (private network, scheme) |
| `timeout`                  | Request timed out                                    |
| `error`                    | Network or fetch error                               |
| `oversized`                | Response exceeded the byte limit                     |
| `redirect_limit_exceeded`  | Too many redirects                                   |

## Options

```typescript
interface ParseOptions {
  remoteFetch?: boolean            // Enable remote inspection (default: true)
  maxInputBytes?: number           // Max input size (default: 16,384)
  ipfsGatewayBaseUrl?: string      // IPFS gateway base URL for gateway URL construction
  allowHttp?: boolean              // Allow HTTP (not just HTTPS) for remote fetch (default: false)
  allowPrivateNetworks?: boolean   // Allow fetching private/localhost IPs (default: false)
  maxRedirects?: number            // Max redirects to follow (default: 3)
  connectTimeoutMs?: number        // Connection timeout (default: 3,000)
  requestTimeoutMs?: number        // Request timeout (default: 5,000)
  ipfsRequestTimeoutMs?: number    // IPFS-specific timeout (default: 8,000)
  maxResponseBytes?: number        // Max response body size (default: 1,048,576)
  inspectBytes?: number            // Bytes to read for content sniffing (default: 262,144)
}
```

## Error Handling

`parseAtom` throws `ParseError` for invalid inputs:

```typescript
import { ParseError } from '@0xintuition/atom-parser/types'

try {
  await parseAtom('')
} catch (err) {
  if (err instanceof ParseError) {
    console.log(err.code)    // 'EMPTY_INPUT'
    console.log(err.message) // 'input must not be empty'
  }
}
```

| Error Code              | Cause                              |
| ----------------------- | ---------------------------------- |
| `EMPTY_INPUT`           | Input is empty or whitespace-only  |
| `INPUT_TOO_LARGE`       | Input exceeds `maxInputBytes`      |
| `INVALID_IPFS_GATEWAY`  | Malformed IPFS gateway URL         |
| `INVALID_REQUEST`       | Invalid request parameters         |
| `INTERNAL_ERROR`        | Unexpected internal failure        |

## Detection Precedence

When an input could match multiple kinds, the first match wins:

1. IPFS (`ipfs://` or `/ipfs/` prefix)
2. Ethereum address (`0x` + 40 hex chars)
3. ENS name (`*.eth`)
4. JSON (valid object or array)
5. URL (parseable URL)
6. ISBN (valid ISBN-10 or ISBN-13)
7. Plain string (fallback)
