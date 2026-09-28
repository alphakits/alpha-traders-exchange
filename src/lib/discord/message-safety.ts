import "server-only";

export function escapeDiscordPlainText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/([\\`*_{}[\]()<>#+\-.!|~])/g, "\\$1")
    .replace(/https?:\/\//gi, "")
    .replace(/@/g, "@\u200b")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
