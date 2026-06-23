import mongoose, { Schema, models } from "mongoose";

const chargeSchema = new Schema(
  {
    label: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const monthlyChargeSchema = new Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    label: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const specificDateChargeSchema = new Schema(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    day: { type: Number, required: true, min: 1, max: 31 },
    label: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const dateRangeChargeSchema = new Schema(
  {
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    label: { type: String, required: true },
    amount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const cleaningCapSchema = new Schema(
  {
    property: { type: String, default: "" },
    maxAmount: { type: Number, required: true, default: 0 }
  },
  { _id: false }
);

const taxFlagsSchema = new Schema(
  {
    SC: { type: Boolean, default: false },
    MB: { type: Boolean, default: false },
    NMB: { type: Boolean, default: false },
    SSB: { type: Boolean, default: false },
    HC: { type: Boolean, default: false },
    GTC: { type: Boolean, default: false }
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "owner"], required: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "Owner", default: null },
    displayName: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

const ownerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true },
    type: { type: String, enum: ["draft", "payout", "split"], required: true, default: "draft" },
    percent: { type: Number, default: 0 },
    salesFeePercent: { type: Number, default: 0 },
    splitOwnerPercent: { type: Number, default: 0 },
    cleaningFee: { type: Number, default: 0 },
    cleaningCaps: { type: [cleaningCapSchema], default: [] },
    guestyReportUrl: { type: String, default: "" },
    guestyAllPropertiesUrl: { type: String, default: "" },
    properties: { type: [String], default: [] },
    legacyImport: {
      source: { type: String, default: "" },
      reservationCount: { type: Number, default: 0 },
      warning: { type: String, default: "" },
      importedAt: { type: Date, default: null }
    },
    recurringCharges: { type: [chargeSchema], default: [] },
    monthlyRecurringCharges: { type: [monthlyChargeSchema], default: [] },
    specificDateRecurringCharges: { type: [specificDateChargeSchema], default: [] },
    dateRangeRecurringCharges: { type: [dateRangeChargeSchema], default: [] }
  },
  { timestamps: true, versionKey: false }
);

const vendorSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    phone: { type: String, default: "" }
  },
  { timestamps: true, versionKey: false }
);

const expenseSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "Owner", required: true, index: true },
    property: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    vendor: { type: String, default: "", trim: true },
    amount: { type: Number, required: true, default: 0 },
    notes: { type: String, default: "" },
    invoiceUrl: { type: String, default: "" },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

expenseSchema.index({ ownerId: 1, year: 1, month: 1, property: 1 });

const propertySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    reportAddress: { type: String, default: "", trim: true },
    municipality: { type: String, default: "", trim: true },
    taxFlags: { type: taxFlagsSchema, default: () => ({}) }
  },
  { timestamps: true, versionKey: false }
);

const savedReportSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "Owner", default: null, index: true },
    reportKey: { type: String, required: true },
    reportTitle: { type: String, required: true },
    periodLabel: { type: String, default: "" },
    htmlSnapshot: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    shareId: { type: String, required: true, unique: true, index: true }
  },
  { versionKey: false }
);

const guestyCacheSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "Owner", required: true, index: true },
    cacheKey: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
  },
  { versionKey: false }
);

guestyCacheSchema.index({ ownerId: 1, cacheKey: 1 }, { unique: true });
guestyCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const reservationOverrideSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "Owner", required: true, index: true },
    reservationId: { type: String, required: true },
    values: { type: Schema.Types.Mixed, default: {} },
    deleted: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false }
);

reservationOverrideSchema.index({ ownerId: 1, reservationId: 1 }, { unique: true });

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: true, versionKey: false }
);

export const User: any = models.User || mongoose.model("User", userSchema);
export const Owner: any = models.Owner || mongoose.model("Owner", ownerSchema);
export const Vendor: any = models.Vendor || mongoose.model("Vendor", vendorSchema);
export const Expense: any = models.Expense || mongoose.model("Expense", expenseSchema);
export const Property: any = models.Property || mongoose.model("Property", propertySchema);
export const SavedReport: any = models.SavedReport || mongoose.model("SavedReport", savedReportSchema);
export const GuestyCache: any = models.GuestyCache || mongoose.model("GuestyCache", guestyCacheSchema);
export const ReservationOverride: any = models.ReservationOverride || mongoose.model("ReservationOverride", reservationOverrideSchema);
export const Setting: any = models.Setting || mongoose.model("Setting", settingSchema);
