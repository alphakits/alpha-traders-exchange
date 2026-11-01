// Next's documented test seam avoids downloading fonts during offline builds.
// These local system faces are preview substitutes, not shipped font assets.
module.exports = new Proxy({}, {
  get(_target, key) {
    if (typeof key !== "string" || !key.startsWith("https://fonts.googleapis.com/")) return undefined;
    const family = new URL(key).searchParams.get("family") ?? "";
    const name = family.startsWith("IBM Plex Sans Arabic") ? "IBM Plex Sans Arabic" : family.startsWith("Inter") ? "Inter" : null;
    if (!name) return undefined;
    return `@font-face { font-family: '${name}'; font-style: normal; font-weight: 100 900; font-display: swap; src: local('Arial'); }`;
  },
});
