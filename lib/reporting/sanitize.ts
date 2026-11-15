export function stripReportEditControls(html: string) {
  return html
    .replace(/<th>\s*Actions\s*<\/th>/gi, "")
    .replace(/<td\s+class=["']row-actions["'][^>]*>[\s\S]*?<\/td>/gi, "")
    .replace(/<button\b[^>]*data-report-action=["'](?:edit|delete)["'][\s\S]*?<\/button>/gi, "");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function addTableDataLabels(html: string) {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
      match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    );
    if (!headers.length) return table;
    let index = 0;
    return table.replace(/<td\b([^>]*)>/gi, (full, attrs: string) => {
      const colspan = Number(attrs.match(/colspan=["']?(\d+)/i)?.[1] || 1);
      const label = headers[index] || "";
      index += Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
      if (/\sdata-label=/.test(` ${attrs}`)) return full;
      return `<td${attrs} data-label="${escapeAttr(label)}">`;
    });
  });
}

export function prepareSharedReportHtml(html: string, shareId: string) {
  const encodedShareId = encodeURIComponent(shareId);

  return addTableDataLabels(stripReportEditControls(html)).replace(
    /(href=["'])([^"']*\/api\/invoices\/[a-f\d]{24})(?:\?[^"']*)?(["'])/gi,
    `$1$2?shareId=${encodedShareId}$3`
  );
}
