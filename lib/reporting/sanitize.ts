export function stripReportEditControls(html: string) {
  return html
    .replace(/<th>\s*Actions\s*<\/th>/gi, "")
    .replace(/<td\s+class=["']row-actions["'][^>]*>[\s\S]*?<\/td>/gi, "")
    .replace(/<button\b[^>]*data-report-action=["'](?:edit|delete)["'][\s\S]*?<\/button>/gi, "");
}

export function prepareSharedReportHtml(html: string, shareId: string) {
  const encodedShareId = encodeURIComponent(shareId);

  return stripReportEditControls(html).replace(
    /(href=["'])([^"']*\/api\/invoices\/[a-f\d]{24})(?:\?[^"']*)?(["'])/gi,
    `$1$2?shareId=${encodedShareId}$3`
  );
}
