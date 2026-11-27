import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense, GuestyCache, Owner, ReservationOverride } from "@/lib/models";
import { fail, ok } from "@/lib/http";
import { findFinalStatement } from "@/lib/locked-statement-store";
import { recurringExpenses } from "@/lib/reporting/reports";
import type { OwnerLike } from "@/lib/types";

export const runtime = "nodejs";

const kindSchema = z.enum(["reservation", "expense", "recurring"]);

const schema = z.object({
  ownerId: z.string(),
  kind: kindSchema,
  id: z.string(),
  values: z.record(z.string(), z.union([z.string(), z.number()])).optional().default({})
});

function numberValue(value: unknown) {
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitPeriod(value: unknown) {
  const [month, year] = String(value || "").split("/").map((part) => Number(part.trim()));
  return {
    month: Number.isFinite(month) && month > 0 ? month : undefined,
    year: Number.isFinite(year) && year > 0 ? year : undefined
  };
}

function normalizedDateValue(value: unknown) {
  const text = String(value || "").trim();
  const usDate = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (usDate) return `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

async function updateReservation(
  ownerId: string,
  id: string,
  values: Record<string, string | number>,
  options: { manual?: boolean } = {}
) {
  const existing = await ReservationOverride.findOne({ ownerId, reservationId: id }).lean();
  const caches = options.manual ? [] : await GuestyCache.find({ ownerId }).sort({ createdAt: -1 }).lean();
  const existsInCache = caches.some((cache: { payload?: unknown }) =>
    (Array.isArray(cache.payload) ? cache.payload : []).some((row: Record<string, unknown>) => String(row.id) === id)
  );
  if (!options.manual && !existsInCache && !existing?.manual) {
    throw Object.assign(new Error("Reservation row not found in Guesty data."), { status: 404 });
  }

  const overrideValues: Record<string, string | number> = {};

  if (values.property !== undefined) overrideValues.property = String(values.property);
  if (values.guestName !== undefined) overrideValues.guestName = String(values.guestName);
  if (values.reservationCode !== undefined) overrideValues.confirmationCode = String(values.reservationCode);
  if (values.checkIn !== undefined) overrideValues.checkIn = normalizedDateValue(values.checkIn);
  if (values.checkOut !== undefined) overrideValues.checkOut = normalizedDateValue(values.checkOut);
  if (values.nights !== undefined) overrideValues.nights = numberValue(values.nights);
  if (values.source !== undefined) overrideValues.source = String(values.source);
  if (values.grossPayout !== undefined) overrideValues.manualTotalPayout = numberValue(values.grossPayout);
  if (values.cleaningFee !== undefined) overrideValues.manualCleaningFare = numberValue(values.cleaningFee);
  if (values.netAcc !== undefined) overrideValues.manualAccommodation = numberValue(values.netAcc);
  if (values.vrboWebsiteFee !== undefined) overrideValues.manualWebsiteFee = numberValue(values.vrboWebsiteFee);
  if (values.pmc !== undefined) overrideValues.manualPmc = numberValue(values.pmc);
  if (values.ownerPayout !== undefined) overrideValues.manualOwnerPayout = numberValue(values.ownerPayout);
  if (values.amountDue !== undefined) overrideValues.manualAmountDue = numberValue(values.amountDue);
  if (values.ownerStay !== undefined) overrideValues.manualAmountDue = numberValue(values.ownerStay);
  if (values.expectedPayout !== undefined) overrideValues.manualExpectedPayoutDate = normalizedDateValue(values.expectedPayout);

  const mergedValues = { ...(existing?.values || {}), ...overrideValues };
  if (numberValue(values.autoRecalculate) === 1) {
    delete mergedValues.manualPmc;
    delete mergedValues.manualOwnerPayout;
    delete mergedValues.manualAmountDue;
  }

  await ReservationOverride.updateOne(
    { ownerId, reservationId: id },
    {
      $set: {
        values: mergedValues,
        manual: Boolean(options.manual || existing?.manual),
        deleted: false
      }
    },
    { upsert: true }
  );
}

async function updateRecurring(ownerId: string, id: string, values?: Record<string, string | number>) {
  const match = /^recurring:((\d{4})-(1[0-2]|[1-9])-[a-f0-9]{64})$/.exec(id);
  if (!match) throw Object.assign(new Error("Refresh the statement and try again."), { status: 400 });
  const [, key, yearText, monthText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  if (await findFinalStatement(ownerId, year, month)) {
    throw Object.assign(new Error("Use the locked statement controls to modify this month."), { status: 409 });
  }

  const owner = await Owner.findById(ownerId).lean();
  const start = `${yearText}-${monthText.padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  if (!owner || !recurringExpenses(owner as unknown as OwnerLike, start, end, true).some((line) => line._id === id)) {
    throw Object.assign(new Error("Recurring charge not found. Refresh the statement and try again."), { status: 404 });
  }

  const path = `recurringStatementOverrides.${key}`;
  const updates: Record<string, string | number | boolean> = { [`${path}.deleted`]: !values };
  if (values?.type !== undefined) updates[`${path}.type`] = String(values.type);
  if (values?.amount !== undefined) updates[`${path}.amount`] = numberValue(values.amount);
  if (values?.note !== undefined) updates[`${path}.notes`] = String(values.note);
  await Owner.updateOne({ _id: ownerId }, { $set: updates });
}

export async function PATCH(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());

    if (body.kind === "reservation") await updateReservation(body.ownerId, body.id, body.values);
    if (body.kind === "expense") {
      const updates: Record<string, string | number> = { ...body.values };
      if (updates.note !== undefined && updates.notes === undefined) {
        updates.notes = updates.note;
        delete updates.note;
      }
      if (updates.period !== undefined) {
        const period = splitPeriod(updates.period);
        if (period.month) updates.month = period.month;
        if (period.year) updates.year = period.year;
        delete updates.period;
      }
      if (updates.amount !== undefined) updates.amount = numberValue(updates.amount);
      await Expense.findOneAndUpdate({ _id: body.id, ownerId: body.ownerId }, { $set: updates });
    }
    if (body.kind === "recurring") await updateRecurring(body.ownerId, body.id, body.values);

    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    if (body.kind !== "reservation") {
      throw Object.assign(new Error("Only missing reservations can be added here."), { status: 400 });
    }
    await updateReservation(body.ownerId, body.id, body.values, { manual: true });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());

    if (body.kind === "reservation") {
      const existing = await ReservationOverride.findOne({ ownerId: body.ownerId, reservationId: body.id }).lean();
      if (!existing?.manual) {
        throw Object.assign(
          new Error("Guesty reservations cannot be deleted. Edit the reservation dates or details instead."),
          { status: 400 }
        );
      }
      await ReservationOverride.deleteOne({ ownerId: body.ownerId, reservationId: body.id });
    }
    if (body.kind === "expense") await Expense.deleteOne({ _id: body.id, ownerId: body.ownerId });
    if (body.kind === "recurring") await updateRecurring(body.ownerId, body.id);

    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
