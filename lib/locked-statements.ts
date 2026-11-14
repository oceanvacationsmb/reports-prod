export type StatementLine = {
  label: string;
  amount: number;
  property?: string;
};

export type StatementExpenseLine = {
  property: string;
  type: string;
  amount: number;
  notes?: string;
  vendor?: string;
};

export type StatementTotals = {
  netAccommodation: number;
  pmc: number;
  expenses: number;
  recurringCharges: number;
  ownerPayout: number;
};

export type FinalStatement = {
  ownerId: string;
  year: number;
  month: number;
  shareId: string;
  periodLabel: string;
  htmlSnapshot: string;
  recurring: StatementLine[];
  expenses: StatementExpenseLine[];
  totals: StatementTotals;
  depositRecorded: boolean;
  locked: true;
  lockedAt: string;
  lockedBy?: string;
};

export type StatementAuditRecord = {
  ownerId: string;
  year: number;
  month: number;
  shareId: string;
  action: "modify";
  who: string;
  when: string;
  before: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
  };
  after: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
  };
};

export type FinalMonthInput = {
  year: number;
  month: number;
  shareId: string;
  depositRecorded: boolean;
  totals: StatementTotals;
};

export type Final1099Row = {
  month: number;
  final: boolean;
  depositRecorded: boolean;
  shareId?: string;
  netAccommodation: number;
  pmc: number;
  expenses: number;
  netToOwner: number;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function cents(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function copyLine(line: StatementLine): StatementLine {
  return {
    label: line.label,
    amount: cents(line.amount),
    property: line.property || ""
  };
}

function copyExpense(line: StatementExpenseLine): StatementExpenseLine {
  return {
    property: line.property || "",
    type: line.type || "",
    amount: cents(line.amount),
    notes: line.notes || "",
    vendor: line.vendor || ""
  };
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function linesForMonth(baseLines: StatementLine[], finalStatement: Pick<FinalStatement, "locked" | "recurring"> | null) {
  if (finalStatement?.locked) return finalStatement.recurring.map(copyLine);
  return baseLines.map(copyLine);
}

export function lockOnEmail(existing: FinalStatement | null, draft: Omit<FinalStatement, "locked">): { record: FinalStatement; created: boolean } {
  if (existing?.locked) return { record: existing, created: false };
  return {
    record: {
      ...draft,
      recurring: draft.recurring.map(copyLine),
      expenses: draft.expenses.map(copyExpense),
      locked: true
    },
    created: true
  };
}

export function modifyLock(
  existing: FinalStatement,
  next: {
    recurring: StatementLine[];
    expenses: StatementExpenseLine[];
    totals: StatementTotals;
    htmlSnapshot: string;
    depositRecorded?: boolean;
  },
  who: string,
  when: string
): { lock: FinalStatement; audit: StatementAuditRecord } {
  const after = {
    recurring: next.recurring.map(copyLine),
    expenses: next.expenses.map(copyExpense),
    totals: { ...next.totals },
    htmlSnapshot: next.htmlSnapshot
  };
  return {
    lock: {
      ...existing,
      ...after,
      depositRecorded: next.depositRecorded ?? true,
      locked: true,
      shareId: existing.shareId,
      lockedAt: existing.lockedAt
    },
    audit: {
      ownerId: existing.ownerId,
      year: existing.year,
      month: existing.month,
      shareId: existing.shareId,
      action: "modify",
      who,
      when,
      before: {
        recurring: existing.recurring.map(copyLine),
        expenses: existing.expenses.map(copyExpense),
        totals: { ...existing.totals },
        htmlSnapshot: existing.htmlSnapshot
      },
      after
    }
  };
}

export function buildFinal1099(year: number, finals: FinalMonthInput[]) {
  const byMonth = new Map<number, FinalMonthInput>();
  for (const item of finals) {
    if (item.year !== year || item.month < 1 || item.month > 12) continue;
    if (!byMonth.has(item.month)) byMonth.set(item.month, item);
  }

  const months: Final1099Row[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const finalMonth = byMonth.get(month);
    if (!finalMonth) {
      months.push({
        month,
        final: false,
        depositRecorded: false,
        netAccommodation: 0,
        pmc: 0,
        expenses: 0,
        netToOwner: 0
      });
      continue;
    }
    const expenses = cents(finalMonth.totals.expenses + finalMonth.totals.recurringCharges);
    months.push({
      month,
      final: true,
      depositRecorded: finalMonth.depositRecorded,
      shareId: finalMonth.shareId,
      netAccommodation: cents(finalMonth.totals.netAccommodation),
      pmc: cents(finalMonth.totals.pmc),
      expenses,
      netToOwner: finalMonth.depositRecorded ? cents(finalMonth.totals.ownerPayout) : 0
    });
  }

  const included = months.filter((row) => row.final && row.depositRecorded);
  return {
    months,
    missingMonths: months.filter((row) => !row.final).map((row) => row.month),
    incompleteMonths: months.filter((row) => row.final && !row.depositRecorded).map((row) => row.month),
    totals: {
      netAccommodation: cents(included.reduce((sum, row) => sum + row.netAccommodation, 0)),
      pmc: cents(included.reduce((sum, row) => sum + row.pmc, 0)),
      expenses: cents(included.reduce((sum, row) => sum + row.expenses, 0)),
      netToOwner: cents(included.reduce((sum, row) => sum + row.netToOwner, 0))
    }
  };
}

export type BackfillInput = {
  ownerId: string;
  ownerName: string;
  property?: string;
  year: number;
  month: number;
  shareId: string;
  recurring: StatementLine[];
  expenses?: StatementExpenseLine[];
  totals?: Partial<StatementTotals>;
  nights?: number;
  propertyPayoutBeforeRecurring?: number;
  lockedAt: string;
  lockedBy?: string;
  sourceNote?: string;
};

export function backfillLock(input: BackfillInput): FinalStatement {
  const recurring = input.recurring.map((line) => copyLine({ ...line, property: line.property || input.property || "Recurring" }));
  const expenses = (input.expenses || []).map(copyExpense);
  const recurringCharges = cents(recurring.reduce((sum, line) => sum + line.amount, 0));
  const expenseTotal = cents(expenses.reduce((sum, line) => sum + line.amount, 0));
  const depositRecorded = typeof input.totals?.ownerPayout === "number";
  const totals: StatementTotals = {
    netAccommodation: cents(input.totals?.netAccommodation ?? 0),
    pmc: cents(input.totals?.pmc ?? 0),
    expenses: cents(input.totals?.expenses ?? expenseTotal),
    recurringCharges: cents(input.totals?.recurringCharges ?? recurringCharges),
    ownerPayout: cents(input.totals?.ownerPayout ?? 0)
  };
  return {
    ownerId: input.ownerId,
    year: input.year,
    month: input.month,
    shareId: input.shareId,
    periodLabel: `${monthNames[input.month - 1] || "Month"} ${input.year}`,
    htmlSnapshot: backfillHtml({ ...input, recurring, expenses, totals, recurringCharges, depositRecorded }),
    recurring,
    expenses,
    totals,
    depositRecorded,
    locked: true,
    lockedAt: input.lockedAt,
    lockedBy: input.lockedBy || ""
  };
}

function backfillHtml(input: BackfillInput & { recurring: StatementLine[]; expenses: StatementExpenseLine[]; totals: StatementTotals; recurringCharges: number; depositRecorded: boolean }) {
  const recurringRows = input.recurring
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.property || input.property || "Recurring")}</td><td>${escapeHtml(line.label)}</td><td>${escapeHtml(money.format(line.amount))}</td><td>Base recurring charge</td></tr>`
    )
    .join("");
  const expenseRows = input.expenses
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.property)}</td><td>${escapeHtml(line.type)}</td><td>${escapeHtml(money.format(line.amount))}</td><td>${escapeHtml(line.notes || line.vendor || "")}</td></tr>`
    )
    .join("");
  const deposit = input.depositRecorded
    ? money.format(input.totals.ownerPayout)
    : "Deposit not recorded";
  const propertyPayout = typeof input.propertyPayoutBeforeRecurring === "number"
    ? `<p>Property payout before recurring: ${escapeHtml(money.format(input.propertyPayoutBeforeRecurring))}</p>`
    : "";
  const nights = typeof input.nights === "number" ? `<p>Nights: ${input.nights}</p>` : "";
  return `
    <article class="report-sheet">
      <h1>${escapeHtml(input.ownerName)} Statement</h1>
      <p>${escapeHtml(monthNames[input.month - 1] || "")} ${input.year}</p>
      <p>${escapeHtml(input.sourceNote || "Saved from a known statement.")}</p>
      <table>
        <thead><tr><th>Property</th><th>Description</th><th>Amount</th><th>Note</th></tr></thead>
        <tbody>
          ${recurringRows}
          ${expenseRows}
          <tr><td></td><td>Recurring total</td><td>${escapeHtml(money.format(input.recurringCharges))}</td><td></td></tr>
        </tbody>
      </table>
      <p>Net accommodation ${escapeHtml(money.format(input.totals.netAccommodation))}. PMC ${escapeHtml(money.format(input.totals.pmc))}. Expenses ${escapeHtml(money.format(input.totals.expenses))}.</p>
      ${propertyPayout}
      ${nights}
      <p>Net to owner: ${escapeHtml(deposit)}</p>
    </article>
  `;
}

export function planBackfill(existing: { shareId: string } | null, input: BackfillInput) {
  if (existing?.shareId) {
    return {
      action: "skip" as const,
      shareId: existing.shareId,
      reason: "This month is already a final statement."
    };
  }
  return {
    action: "create" as const,
    lock: backfillLock(input)
  };
}
