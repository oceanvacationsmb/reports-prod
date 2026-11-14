import crypto from "crypto";
import { connectDb } from "@/lib/db";
import { OwnerStatementVersion, SavedReport, Setting, StatementBatch } from "@/lib/models";
import { asPlain } from "@/lib/http";
import { buildOwnerReport, makeShareId, statementTransferFigures } from "@/lib/reporting/reports";
import { loadOwners, loadPeriodInputs } from "@/lib/reporting/load-period";
import { buildSummaryReport } from "@/lib/reporting/reports";
import {
  decideStatementDispatch,
  executeDispatch,
  planStatementVersion,
  statementEmail,
  type OwnerStatementState,
  type StatementVersionRef
} from "@/lib/statements/dispatch";
import { createGmailSender, gmailEnvFromProcess } from "@/lib/statements/gmail";
import { monthLabel } from "@/lib/statements/schedule";

function appUrl() {
  return (process.env.APP_URL || "https://reports.oceanvacationsmb.com").replace(/\/$/, "");
}

function versionRef(doc: {
  _id: unknown;
  version: number;
  status: StatementVersionRef["status"];
  contentHash: string;
  gmailMessageId?: string;
  shareId?: string;
  recipient?: string;
}): StatementVersionRef {
  return {
    id: String(doc._id),
    version: doc.version,
    status: doc.status,
    contentHash: doc.contentHash,
    gmailMessageId: doc.gmailMessageId || "",
    shareId: doc.shareId || "",
    recipient: doc.recipient || ""
  };
}

export async function gmailConnection() {
  await connectDb();
  const setting = await Setting.findOne({ key: "gmail-oauth" }).lean();
  const value = setting?.value || {};
  const env = gmailEnvFromProcess();
  return {
    enabled: env.sendEnabled,
    connected: Boolean(value.refreshToken),
    email: String(value.email || ""),
    refreshToken: String(value.refreshToken || "")
  };
}

export async function generateStatementMonth(year: number, month: number) {
  const { settings, owners, properties, expensesByOwner, reservationsByOwner } = await loadPeriodInputs(year, month);
  const created: string[] = [];
  const unchanged: string[] = [];
  for (const owner of owners) {
    const ownerId = String(owner._id || owner.id);
    const request = { month, year, calculationSource: "reports" as const };
    const figures = statementTransferFigures(
      owner,
      reservationsByOwner.get(ownerId) || [],
      expensesByOwner.get(ownerId) || [],
      settings,
      request
    );
    const report = buildOwnerReport(owner, reservationsByOwner.get(ownerId) || [], expensesByOwner.get(ownerId) || [], settings, {
      reportKey: "statement",
      ...request,
      readOnly: true
    }, properties);
    const contentHash = crypto.createHash("sha256").update(report.html).digest("hex");
    const existing = asPlain(
      await OwnerStatementVersion.find({ ownerId, year, month }).select("version status contentHash").lean()
    ) as { version: number; status: StatementVersionRef["status"]; contentHash: string }[];
    const plan = planStatementVersion(existing, contentHash);
    if (plan.action === "unchanged") {
      unchanged.push(owner.name);
      continue;
    }
    const payload = {
      ownerName: owner.name,
      recipient: owner.email || "",
      contentHash,
      htmlSnapshot: report.html,
      title: report.title,
      periodLabel: report.periodLabel,
      figures
    };
    if (plan.action === "replace_pending") {
      await OwnerStatementVersion.updateOne({ ownerId, year, month, version: plan.version, status: "pending" }, { $set: payload });
    } else {
      await OwnerStatementVersion.create({
        ownerId,
        year,
        month,
        version: plan.version,
        status: "pending",
        shareId: "",
        gmailMessageId: "",
        ...payload
      });
    }
    created.push(owner.name);
  }
  return { created, unchanged };
}

export async function listStatementVersions(year: number, month: number) {
  await connectDb();
  const docs = asPlain(
    await OwnerStatementVersion.find({ year, month }).sort({ ownerName: 1, version: 1 }).lean()
  ) as Record<string, unknown>[];
  return docs.map((doc) => ({
    id: String(doc._id),
    ownerId: String(doc.ownerId),
    ownerName: String(doc.ownerName || ""),
    recipient: String(doc.recipient || ""),
    year: Number(doc.year),
    month: Number(doc.month),
    version: Number(doc.version),
    status: String(doc.status),
    shareId: String(doc.shareId || ""),
    gmailMessageId: String(doc.gmailMessageId || ""),
    sentAt: doc.sentAt || null,
    approvedAt: doc.approvedAt || null,
    lastError: String(doc.lastError || ""),
    periodLabel: String(doc.periodLabel || ""),
    figures: doc.figures || {}
  }));
}

function latestByOwner(versions: Awaited<ReturnType<typeof listStatementVersions>>, owners: { _id?: string; id?: string; name: string; email?: string }[]) {
  const grouped = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    const current = grouped.get(version.ownerId);
    if (!current || version.version > current.version) grouped.set(version.ownerId, version);
  }
  return owners.map((owner) => {
    const ownerId = String(owner._id || owner.id);
    const latest = grouped.get(ownerId);
    return {
      ownerId,
      name: owner.name,
      email: owner.email || "",
      latest: latest
        ? versionRef({
            _id: latest.id,
            version: latest.version,
            status: latest.status as StatementVersionRef["status"],
            contentHash: "",
            gmailMessageId: latest.gmailMessageId,
            shareId: latest.shareId,
            recipient: latest.recipient
          })
        : null
    } satisfies OwnerStatementState;
  });
}

export async function statementBatchView(year: number, month: number, now = new Date()) {
  const owners = await loadOwners();
  const versions = await listStatementVersions(year, month);
  const decision = decideStatementDispatch({
    now,
    year,
    month,
    owners: latestByOwner(versions, owners),
    manualAuthorization: false
  });
  const gmail = await gmailConnection();
  return {
    year,
    month,
    periodLabel: monthLabel(year, month),
    versions,
    decision,
    gmail: { enabled: gmail.enabled, connected: gmail.connected, email: gmail.email }
  };
}

export async function approveStatementVersion(id: string) {
  await connectDb();
  const version = await OwnerStatementVersion.findById(id);
  if (!version) throw Object.assign(new Error("Statement version not found."), { status: 404 });
  if (version.status !== "pending") throw Object.assign(new Error("Only a pending statement can be approved."), { status: 409 });
  const shareId = version.shareId || makeShareId();
  if (!version.shareId) {
    await SavedReport.create({
      ownerId: version.ownerId,
      reportKey: "statement",
      reportTitle: version.title,
      periodLabel: version.periodLabel,
      htmlSnapshot: version.htmlSnapshot,
      shareId
    });
  }
  version.status = "approved_locked";
  version.shareId = shareId;
  version.approvedAt = new Date();
  version.lastError = "";
  await version.save();
  return { id: String(version._id), shareId, status: version.status };
}

export async function dispatchStatementMonth(year: number, month: number, options: { manualAuthorization: boolean; now?: Date }) {
  const now = options.now || new Date();
  const owners = await loadOwners();
  const versions = await listStatementVersions(year, month);
  const decision = decideStatementDispatch({
    now,
    year,
    month,
    owners: latestByOwner(versions, owners),
    manualAuthorization: options.manualAuthorization
  });
  const gmail = await gmailConnection();
  const sender = createGmailSender({ env: gmailEnvFromProcess(), refreshToken: gmail.refreshToken });
  const summary = await executeDispatch(decision, {
    send: async (version) => {
      const claimed = await OwnerStatementVersion.findOneAndUpdate(
        { _id: version.versionId, status: "approved_locked", gmailMessageId: "" },
        { $set: { status: "sending", lastError: "" } },
        { new: true }
      );
      if (!claimed) throw new Error("This version was already sent or is no longer approved.");
      const email = statementEmail({
        ownerName: version.name,
        periodLabel: claimed.periodLabel || monthLabel(year, month),
        shareUrl: `${appUrl()}/share/${version.shareId}`
      });
      return sender.send({ to: version.email, ...email });
    },
    markSent: async (version, gmailMessageId) => {
      await OwnerStatementVersion.updateOne(
        { _id: version.versionId },
        { $set: { status: "sent", gmailMessageId, sentAt: new Date(), recipient: version.email, lastError: "" } }
      );
    },
    markFailed: async (version, error) => {
      await OwnerStatementVersion.updateOne(
        { _id: version.versionId, status: "sending" },
        { $set: { status: "approved_locked", lastError: error } }
      );
      await OwnerStatementVersion.updateOne(
        { _id: version.versionId, status: "approved_locked" },
        { $set: { lastError: error } }
      );
    }
  });
  const waiting = decision.action === "deadline_miss" || decision.action === "hold" ? decision.waiting.map((item) => item.name) : [];
  await StatementBatch.findOneAndUpdate(
    { year, month },
    {
      $set: {
        deadlineMissedAt: decision.action === "deadline_miss" ? now : undefined,
        deadlineMessage: decision.action === "deadline_miss" ? decision.message : decision.action === "hold_for_manual" ? decision.message : "",
        waitingNames: waiting,
        lastSummary: { action: decision.action, summary, at: now.toISOString() }
      }
    },
    { upsert: true }
  );
  return { decision, summary };
}

export async function approvedStatementHtml(year: number, month: number) {
  await connectDb();
  const docs = asPlain(await OwnerStatementVersion.find({ year, month, status: { $in: ["approved_locked", "sent"] } }).sort({ ownerName: 1, version: 1 }).lean()) as {
    ownerId: unknown;
    ownerName: string;
    version: number;
    htmlSnapshot: string;
    title: string;
  }[];
  const latest = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    const key = String(doc.ownerId);
    const current = latest.get(key);
    if (!current || doc.version > current.version) latest.set(key, doc);
  }
  return [...latest.values()];
}

export async function summaryReportHtml(year: number, month: number) {
  const { settings, owners, properties, expensesByOwner, reservationsByOwner } = await loadPeriodInputs(year, month);
  const report = buildSummaryReport(owners, reservationsByOwner, expensesByOwner, settings, { reportKey: "summary", year, month }, properties);
  return report;
}

export function printableDocument(title: string, sections: string[], css = "") {
  const body = sections.map((section) => `<section class="statement-print-sheet">${section}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}
    body { margin: 0; background: white; }
    .statement-print-sheet { break-after: page; page-break-after: always; }
    .statement-print-sheet:last-child { break-after: auto; page-break-after: auto; }
  </style></head><body>${body}<script>window.addEventListener("load", () => setTimeout(() => window.print(), 200));</script></body></html>`;
}
