export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  // Integration tests hash passwords and hit a real database; the 5s default
  // is too tight on a busy machine.
  testTimeout: 20000,
  // Tests only ever run against DATABASE_URL_TEST; see tests/setup.
  globalSetup: "<rootDir>/tests/setup/global-setup.js",
  setupFiles: ["<rootDir>/tests/setup/env.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/index.js"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};
