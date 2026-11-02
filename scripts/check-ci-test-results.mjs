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
const numSkippedTests = json.numSkippedTests ?? skipped;
const numFailedTests = json.numFailedTests ?? failed;

const skippedTests = [];
const failedTests = [];
const dbPassedTests = [];

const dbTestFiles = new Set([
  'isolation.test.ts',
  'pairing-security.test.ts',
  'role-permissions.test.ts',
  'ci-db-requirement.test.ts',
  'db-role-security.test.ts',
]);

if (Array.isArray(json.testResults)) {
  for (const suite of json.testResults) {
    const file = path.basename(suite.name || 'unknown');
    const isDbSuite = dbTestFiles.has(file);

    if (Array.isArray(suite.assertionResults)) {
      for (const t of suite.assertionResults) {
        if (t.status === 'skipped' || t.status === 'pending' || t.status === 'todo') {
          skippedTests.push(`[${file}] ${t.fullName || t.title}`);
        } else if (t.status === 'failed') {
          failedTests.push(`[${file}] ${t.fullName || t.title}`);
        } else if (t.status === 'passed' && isDbSuite) {
          dbPassedTests.push(`[${file}] ${t.fullName || t.title}`);
        }
      }
    }
  }
}

console.log('====================================================');
console.log('           CI TEST VERIFICATION SUMMARY             ');
console.log('====================================================');
console.log(`Total Tests:    ${total}`);
console.log(`Passed Tests:   ${passed}`);
console.log(`Failed Tests:   ${failed}`);
console.log(`Skipped Tests:  ${skipped}`);
console.log(`numSkippedTests: ${numSkippedTests}`);
console.log(`numFailedTests:  ${numFailedTests}`);
console.log('====================================================');

console.log('\n--- Database Tests Executed in CI ---');
if (dbPassedTests.length > 0) {
  for (const name of dbPassedTests) {
    console.log(`  ✓ ${name}`);
  }
} else {
  console.log('  (No DB tests recorded as passed)');
}

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

if (numSkippedTests > 0 || numFailedTests > 0 || skipped > 0 || failed > 0) {
  console.error('\nFAILURE: CI requires 0 skipped and 0 failed tests (numSkippedTests === 0 && numFailedTests === 0).');
  process.exit(1);
}

console.log('\n✓ All tests executed and passed with 0 skipped tests.');
process.exit(0);
