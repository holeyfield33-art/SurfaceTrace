module.exports = {
  preset: "ts-jest/presets/default-esm",
  extensionsToTreatAsEsm: [".ts"],
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^@surfacetrace/core$": "<rootDir>/../core/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: { "^.+\\.tsx?$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.test.json" }] },
};
