"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- This file becomes Next's CommonJS runtime config, with no TypeScript loader. */

// Copied to /app/next.config.js in the runtime image. Next's normal custom-server
// loader reads this file, so it needs neither TypeScript nor build-only plugins.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const built = JSON.parse(readFileSync(join(__dirname, ".next", "required-server-files.json"), "utf8"));
if (!built.config || typeof built.config !== "object" || built.config.distDir !== ".next"
  || built.config.output === "standalone" || built.config.output === "export") {
  throw new Error("Container requires a normal Next production build.");
}
const config = { ...built.config, experimental: { ...built.config.experimental } };
// required-server-files also contains internal defaults that are not valid
// user configuration. Let the same pinned Next release restore those defaults.
for (const key of ["configFile", "configFileName", "configOrigin", "amp", "publicRuntimeConfig", "serverRuntimeConfig", "htmlLimitedBots"]) delete config[key];
delete config.experimental.trustHostHeader;
delete config.experimental.isExperimentalCompile;
module.exports = config;
