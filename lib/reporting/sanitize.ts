export function stripReportEditControls(html: string) {
  return html
    .replace(/<th>\s*Actions\s*<\/th>/gi, "")
    .replace(/<td\s+class=["']row-actions["'][^>]*>[\s\S]*?<\/td>/gi, "")
    .replace(/<button\b[^>]*data-report-action=["'](?:edit|delete)["'][\s\S]*?<\/button>/gi, "");
}

function escapeAttr(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function cellText(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

export function addTableDataLabels(html: string) {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const headers = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => cellText(match[1]));
    if (!headers.length) return table;
    return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi, (row) => {
      if (/<th\b/i.test(row)) return row;
      let index = 0;
      return row.replace(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi, (_full, attrs: string, inner: string) => {
        const colspan = Number(attrs.match(/colspan=["']?(\d+)/i)?.[1] || 1);
        const label = headers[index] || "";
        index += Number.isFinite(colspan) && colspan > 0 ? colspan : 1;
        const empty = cellText(inner) === "";
        const labeled = /\sdata-label=/i.test(` ${attrs}`)
          ? `<td${attrs}>`
          : `<td${attrs} data-label="${escapeAttr(label)}">`;
        if (!empty) return `${labeled.slice(0, -1)}>${inner}</td>`;
        const withHidden = /\shidden(?:=|\s|>)/i.test(` ${attrs}`) ? labeled : labeled.replace("<td", "<td hidden");
        return `${withHidden.slice(0, -1)}>${inner}</td>`;
      });
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
