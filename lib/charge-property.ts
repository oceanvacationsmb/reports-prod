export const NO_PROPERTY_LABEL = "No property";

const placeholderProperties = new Set(["", "recurring", "no property"]);

export function storedChargeProperty(value: unknown) {
  const text = String(value || "").trim();
  if (placeholderProperties.has(text.toLowerCase())) return "";
  return text;
}

export function chargePropertyLabel(value: unknown) {
  return storedChargeProperty(value) || NO_PROPERTY_LABEL;
}

const invoicePlaceholders = new Set(["", "no invoice", "optional"]);

export function storedChargeInvoice(value: unknown) {
  const text = String(value || "").trim();
  if (invoicePlaceholders.has(text.toLowerCase())) return "";
  return text;
}
