#!/usr/bin/env node

const userAgent = process.env.npm_config_user_agent ?? '';

if (userAgent.startsWith('bun/')) {
	process.exit(0);
}

const detectedInstaller = userAgent.split(' ')[0] || 'unknown package manager';

console.error(`
This monorepo must be installed with Bun.

Detected: ${detectedInstaller}

Use:
  bun install

Do not use npm, pnpm, or yarn here. Those package managers do not honor this
repo's bunfig.toml minimumReleaseAge supply-chain policy.
`);

process.exit(1);
