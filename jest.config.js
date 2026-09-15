export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  // Tests only ever run against DATABASE_URL_TEST; see tests/setup.
  globalSetup: "<rootDir>/tests/setup/global-setup.js",
  setupFiles: ["<rootDir>/tests/setup/env.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/index.js"],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
};
