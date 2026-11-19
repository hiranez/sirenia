#!/usr/bin/env node
/**
 * Licence gate for production dependencies. No dependencies (Node 20+).
 *
 *   node scripts/licenses/check-licenses.mjs <dir> [<dir> ...]
 *
 * Reads <dir>/package-lock.json and fails when a package that ships (not dev-only) has a licence
 * outside scripts/licenses/policy.json. The lockfile is the source of truth, so no install is needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const policy = JSON.parse(fs.readFileSync(path.join(HERE, 'policy.json'), 'utf8'));
const allowed = new Set(policy.allow);

// SPDX expression: "A OR B" passes if one side is allowed, "A AND B" only if both are.
function expressionAllowed(expression) {
  return expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .some((alternative) => alternative.split(/\s+AND\s+/i).every((id) => allowed.has(id.trim())));
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error('usage: check-licenses.mjs <dir> [<dir> ...]');
  process.exit(2);
}

let failed = false;
for (const dir of dirs) {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package-lock.json'), 'utf8'));
  const tally = new Map();
  const rejected = [];
  let count = 0;
  for (const [location, pkg] of Object.entries(lock.packages || {})) {
    if (!location || pkg.dev || pkg.link) continue; // the project itself, dev-only, workspace links
    count++;
    const name = location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const license = policy.overrides[name]?.license ?? pkg.license;
    if (typeof license !== 'string' || !expressionAllowed(license)) {
      rejected.push(`${name}@${pkg.version}: ${license ?? 'no licence declared'}`);
      continue;
    }
    tally.set(license, (tally.get(license) || 0) + 1);
  }
  const summary = [...tally].sort((a, b) => b[1] - a[1]).map(([license, n]) => `${n} ${license}`).join(', ');
  console.log(`${dir}: ${count} production packages (${summary})`);
  if (rejected.length) {
    failed = true;
    console.log(`FAIL  ${dir}: licence not allowed by scripts/licenses/policy.json\n      ${rejected.join('\n      ')}`);
  }
}
console.log(failed ? '\nLicence check FAILED' : '\nLicence check passed');
process.exit(failed ? 1 : 0);
