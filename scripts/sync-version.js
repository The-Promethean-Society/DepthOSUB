#!/usr/bin/env node

/**
 * Version Synchronization Script
 * 
 * This script ensures that the version number in package.json is synchronized
 * across all files in the codebase to prevent version mismatches during builds.
 * 
 * Usage: node scripts/sync-version.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Read the version from package.json
const packageJsonPath = join(rootDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version;

console.log(`📦 Synchronizing version: ${version}`);

// Files to update with version replacements
const filesToUpdate = [
    {
        path: join(rootDir, 'src', 'extension.ts'),
        replacements: [
            {
                pattern: /outputChannel\.appendLine\('🛰 \[v[\d.]+\] AGNOSTIC CORE ONLINE\.'\);/,
                replacement: `outputChannel.appendLine('🛰 [v${version}] AGNOSTIC CORE ONLINE.');`
            },
            {
                pattern: /this\._client = new Client\(\{ name: "DepthOS Extension", version: "[\d.]+" \}/,
                replacement: `this._client = new Client({ name: "DepthOS Extension", version: "${version}" }`
            },
            {
                pattern: /<div class="diagnostic">\s*DepthOS Agnostic v[\d.]+\s*<\/div>/,
                replacement: `<div class="diagnostic">DepthOS Agnostic v${version}</div>`
            }
        ]
    },
    {
        path: join(rootDir, 'README.md'),
        replacements: [
            {
                pattern: /## Version [\d.]+/,
                replacement: `## Version ${version}`
            },
            {
                pattern: /depthos-bridge-[\d.]+\.vsix/g,
                replacement: `depthos-bridge-${version}.vsix`
            }
        ]
    }
];

let totalReplacements = 0;

filesToUpdate.forEach(({ path, replacements }) => {
    try {
        let content = readFileSync(path, 'utf-8');
        let fileChanged = false;

        replacements.forEach(({ pattern, replacement }) => {
            const matches = content.match(pattern);
            if (matches) {
                content = content.replace(pattern, replacement);
                fileChanged = true;
                totalReplacements++;
                console.log(`  ✅ Updated: ${path.replace(rootDir, '.')}`);
            }
        });

        if (fileChanged) {
            writeFileSync(path, content, 'utf-8');
        }
    } catch (error) {
        console.warn(`  ⚠️  Could not update ${path}: ${error.message}`);
    }
});

console.log(`\n✨ Version synchronization complete! (${totalReplacements} replacements made)`);
console.log(`📌 All files now reference version: ${version}`);
