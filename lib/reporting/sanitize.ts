export function stripReportEditControls(html: string) {
  return html
    .replace(/<th>\s*Actions\s*<\/th>/gi, "")
    .replace(/<td\s+class=["']row-actions["'][^>]*>[\s\S]*?<\/td>/gi, "")
    .replace(/<button\b[^>]*data-report-action=["'](?:edit|delete)["'][\s\S]*?<\/button>/gi, "");
}
