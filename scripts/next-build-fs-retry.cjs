"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- Node's --require preload must be CommonJS. */
const fs = require("node:fs");
const path = require("node:path");

const PATCH_MARKER = Symbol.for("alpha-traders.next-build-fs-retry");

if (!fs.promises[PATCH_MARKER]) {
  const originalRm = fs.promises.rm.bind(fs.promises);
  const managedExportDirectory = path.resolve(process.cwd(), ".next", "export");

  fs.promises.rm = (target, options = {}) => {
    const resolvedTarget = path.resolve(String(target));

    if (resolvedTarget === managedExportDirectory && options.recursive === true) {
      return originalRm(target, {
        ...options,
        // Node does not retry recursive rm calls unless maxRetries is set.
        // Next can briefly race a late static-export write on networked filesystems.
        maxRetries: Math.max(options.maxRetries ?? 0, 10),
        retryDelay: Math.max(options.retryDelay ?? 0, 100),
      });
    }

    return originalRm(target, options);
  };

  Object.defineProperty(fs.promises, PATCH_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
}
