#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const resultsFile = process.argv[2] || 'test-results.json';
const resolvedPath = path.resolve(process.cwd(), resultsFile);

if (!fs.existsSync(resolvedPath)) {
  console.error(`ERROR: Test results file not found at ${resolvedPath}`);
  process.exit(1);
}

const rawData = fs.readFileSync(resolvedPath, 'utf8');
let json;
try {
  json = JSON.parse(rawData);
} catch (err) {
  console.error(`ERROR: Failed to parse test results JSON: ${err.message}`);
  process.exit(1);
}

const total = json.numTotalTests ?? 0;
const passed = json.numPassedTests ?? 0;
const failed = json.numFailedTests ?? 0;
const pending = json.numPendingTests ?? 0;
const skipped = json.numTodoTests ? json.numTodoTests + pending : pending;

const skippedTests = [];
const failedTests = [];

if (Array.isArray(json.testResults)) {
  for (const suite of json.testResults) {
    const file = path.basename(suite.name || 'unknown');
    if (Array.isArray(suite.assertionResults)) {
      for (const t of suite.assertionResults) {
        if (t.status === 'skipped' || t.status === 'pending' || t.status === 'todo') {
          skippedTests.push(`[${file}] ${t.fullName || t.title}`);
        } else if (t.status === 'failed') {
          failedTests.push(`[${file}] ${t.fullName || t.title}`);
        }
      }
    }
  }
}

console.log('====================================================');
console.log('           CI TEST VERIFICATION SUMMARY             ');
console.log('====================================================');
console.log(`Total:   ${total}`);
console.log(`Passed:  ${passed}`);
console.log(`Failed:  ${failed}`);
console.log(`Skipped: ${skipped}`);
console.log('====================================================');

if (skippedTests.length > 0) {
  console.error('\nERROR: The following tests were SKIPPED in CI:');
  for (const name of skippedTests) {
    console.error(`  - ${name}`);
  }
  console.error('\nCI=true requires all tests to run without skipping.');
}

if (failedTests.length > 0) {
  console.error('\nERROR: The following tests FAILED in CI:');
  for (const name of failedTests) {
    console.error(`  - ${name}`);
  }
}

if (skipped > 0 || failed > 0) {
  process.exit(1);
}

console.log('✓ All tests executed and passed with 0 skipped tests.');
process.exit(0);

