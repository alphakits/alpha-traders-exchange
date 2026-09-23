/** Keep native fallback surfaces aligned with the web rank material tokens. */
export const SELLER_PROFILE_TONES = {
  bronze: { accent: "#CD896E", light: "#EFB39B", border: "rgba(205,137,110,.42)", soft: "rgba(205,137,110,.12)", surface: "#391A14", glyph: "✦" },
  silver: { accent: "#C7CBD1", light: "#EDF0F3", border: "rgba(199,203,209,.44)", soft: "rgba(199,203,209,.12)", surface: "#292C32", glyph: "◈" },
  gold: { accent: "#FFD43B", light: "#FFF1A1", border: "rgba(255,212,59,.5)", soft: "rgba(255,212,59,.15)", surface: "#3B2C03", glyph: "★" },
  diamond: { accent: "#55E3FF", light: "#D4FBFF", border: "rgba(85,227,255,.54)", soft: "rgba(85,227,255,.16)", surface: "#082F4B", glyph: "◇" },
  elite: { accent: "#D4B0FA", light: "#F5E7FF", border: "rgba(191,143,239,.36)", soft: "rgba(191,143,239,.12)", surface: "#241B32", glyph: "✧" },
  owner: { accent: "#FB929F", light: "#FFE0DE", border: "rgba(244,97,122,.4)", soft: "rgba(244,97,122,.12)", surface: "#301720", glyph: "♛" },
} as const;
