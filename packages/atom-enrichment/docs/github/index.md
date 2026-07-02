# GitHub | Atom Enrichment

This document defines canonical enrichment payloads for the `github` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/github`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/github/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/github/index.ts`
- **Plugin id:** `github`
- **Artifact type(s):** `github-repo`, `github-user`
- **Classification slug(s):** `github-repo`, `github-user`
- **Runtime:** `server`

## Data Structure

### GitHub Repository Data (`github-repo`)

Repository metadata from GitHub.

```json
{
  "owner": "<string>",
  "name": "<string>",
  "fullName": "<string>",
  "description": "<string_if_available>",
  "language": "<string_if_available>",
  "stars": "<number_if_available>",
  "forks": "<number_if_available>",
  "openIssues": "<number_if_available>",
  "topics": [
    "<string_if_available>"
  ],
  "license": "<string_if_available>",
  "createdAt": "<string_if_available>",
  "updatedAt": "<string_if_available>",
  "homepage": "<https_url_if_available>",
  "defaultBranch": "<string_if_available>"
}
```

### GitHub Repository Artifact

```json
{
  "artifact_type": "github-repo",
  "data": {
    "owner": "<string>",
    "name": "<string>",
    "fullName": "<string>",
    "description": "<string_if_available>",
    "language": "<string_if_available>",
    "stars": "<number_if_available>",
    "forks": "<number_if_available>",
    "openIssues": "<number_if_available>",
    "topics": [
      "<string_if_available>"
    ],
    "license": "<string_if_available>",
    "createdAt": "<string_if_available>",
    "updatedAt": "<string_if_available>",
    "homepage": "<https_url_if_available>",
    "defaultBranch": "<string_if_available>"
  },
  "meta": {
    "pluginId": "github",
    "provider": "github",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```

### GitHub User Profile Data (`github-user`)

User profile metadata from GitHub.

```json
{
  "login": "<string>",
  "name": "<string_if_available>",
  "avatarUrl": "<https_url_if_available>",
  "bio": "<string_if_available>",
  "company": "<string_if_available>",
  "location": "<string_if_available>",
  "blog": "<string_if_available>",
  "publicRepos": "<number_if_available>",
  "followers": "<number_if_available>",
  "following": "<number_if_available>"
}
```

### GitHub User Profile Artifact

```json
{
  "artifact_type": "github-user",
  "data": {
    "login": "<string>",
    "name": "<string_if_available>",
    "avatarUrl": "<https_url_if_available>",
    "bio": "<string_if_available>",
    "company": "<string_if_available>",
    "location": "<string_if_available>",
    "blog": "<string_if_available>",
    "publicRepos": "<number_if_available>",
    "followers": "<number_if_available>",
    "following": "<number_if_available>"
  },
  "meta": {
    "pluginId": "github",
    "provider": "github",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
