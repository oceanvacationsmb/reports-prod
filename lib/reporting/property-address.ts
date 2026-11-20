import type { PropertyLike } from "@/lib/types";

export type PostalAddress = {
  street: string;
  city: string;
  state: string;
  postalCode: string;
};

const POSTAL = /^(\d{5})(?:-\d{4})?$/;
const STATE = /^[A-Za-z]{2}$/;

export function postalAddressFromProperty(property?: Pick<PropertyLike, "reportAddress" | "street" | "city" | "state" | "postalCode"> | null): PostalAddress {
  const street = property?.street?.trim() || "";
  const city = property?.city?.trim() || "";
  const state = property?.state?.trim() || "";
  const postalCode = property?.postalCode?.trim() || "";
  if (street || city || state || postalCode) return { street, city, state, postalCode };
  return parseSingleLineAddress(property?.reportAddress || "");
}

export function parseSingleLineAddress(value: string): PostalAddress {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return { street: "", city: "", state: "", postalCode: "" };
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const stateZip = parts[parts.length - 1].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (stateZip) {
      const city = parts[parts.length - 2].replace(/,+$/g, "").trim();
      const street = parts.slice(0, -2).join(", ");
      if (street && city) return { street, city, state: stateZip[1].toUpperCase(), postalCode: stateZip[2] };
    }
    const postalCode = parts[parts.length - 1];
    const state = parts[parts.length - 2];
    if (STATE.test(state) && POSTAL.test(postalCode)) {
      const city = parts[parts.length - 3].replace(/,+$/g, "").trim();
      const street = parts.slice(0, -3).join(", ");
      if (street && city) return { street, city, state: state.toUpperCase(), postalCode };
    }
  }
  if (parts.length === 2) {
    const street = parts[0];
    const tail = parts[1].match(/^(.*)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (tail) {
      return { street, city: tail[1].replace(/,+$/g, "").trim(), state: tail[2].toUpperCase(), postalCode: tail[3] };
    }
  }
  const loose = text.match(/^(.*?),\s*(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (loose) {
    return { street: loose[1].trim(), city: loose[2].replace(/,+$/g, "").trim(), state: loose[3].toUpperCase(), postalCode: loose[4] };
  }
  return { street: text, city: "", state: "", postalCode: "" };
}

export function localityLine(address: PostalAddress) {
  const stateZip = [address.state, address.postalCode].filter(Boolean).join(" ");
  return [address.city, stateZip].filter(Boolean).join(", ");
}

export function singleLineAddress(address: PostalAddress) {
  return [address.street, localityLine(address)].filter(Boolean).join(", ");
}

export function addressIsComplete(address: PostalAddress) {
  return Boolean(address.street && address.city && address.state && address.postalCode);
}
