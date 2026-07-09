import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Conventional layout: src/router.tsx (getRouter), src/routes/**,
// src/routeTree.gen.ts — tanstackStart() needs no options.
export default defineConfig({
	plugins: [
		tanstackStart(),
		nitroV2Plugin({
			preset: 'node-server',
			compressPublicAssets: false,
			compatibilityDate: '2026-01-28',
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	server: {
		port: 3100,
	},
});
