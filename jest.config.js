/** @type {import('jest').Config} */
const config = {
  // Explicitly define the test environment
  testEnvironment: 'jest-environment-jsdom',

  // Only run files that end with .test.js
  testMatch: ['**/?(*.)+(test).js'],

  // Help Jest resolve modules relative to the tests directory
  modulePaths: ['<rootDir>/tests'],
};

module.exports = config;