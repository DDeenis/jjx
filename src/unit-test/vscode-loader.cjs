const Module = require("node:module");
const path = require("node:path");

const mockPath = path.join(__dirname, "vscode-mock.cjs");
globalThis.__vscodeMock = require(mockPath);
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "vscode") {
    return mockPath;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
