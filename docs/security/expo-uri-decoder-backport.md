# Expo URI decoder security backport

Expo Router 57.0.22 uses query-string 7.1.3, which requires the CommonJS
decode-uri-component 0.2.2. That decoder is affected by
[GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): malformed
percent-encoded input can exhaust CPU or the call stack.

The root dependency pins upstream decode-uri-component 0.5.0. During normal
`npm install`/`npm ci`, `scripts/patch-expo-uri-decoder.mjs` resolves the decoder
actually used by Expo Router and copies the integrity-locked upstream fix into
that legacy package. Only `export default function` becomes `module.exports =
function`. The decoding algorithm is unchanged from upstream; the existing
query-string and Expo interfaces remain intact. Both packages use the MIT
license. Version and source-format guards fail installation if the assumptions
change, rather than silently applying a stale patch.

Run installation scripts in release builds. An `--ignore-scripts` install must
be followed by `npm run postinstall` before using or exporting the native app.
The parser contract tests resolve query-string from Expo's own package context,
so a separate patched dependency cannot mask use of the vulnerable decoder.
They cover case-sensitive trade IDs, redirect paths, Arabic text, arrays, null
and empty values, scalar strings, and malformed input in a time-bounded process.

Package scanners still report the legacy dependency versions, because this
backport does not falsify package metadata or suppress advisory results. Treat
those findings as mitigated only for installations where the patch and parser
tests pass. Retain them as open for the previously built App Store binary.

Validate a fresh install, mobile typecheck, Expo Doctor and both native exports
after changes. A new device/store build is required to deliver this fix to app
users. Remove the backport once Expo Router natively uses a fixed decoder with
a compatible module interface.
