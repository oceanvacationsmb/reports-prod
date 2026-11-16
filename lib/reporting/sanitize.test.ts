import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addTableDataLabels } from "@/lib/reporting/sanitize";

describe("shared statement tables", () => {
  it("labels every charge row and hides an empty invoice cell", () => {
    const html = `
      <table>
        <thead><tr><th>Property</th><th>Type</th><th>Note</th><th>Vendor</th><th>Amount</th><th>Invoice</th></tr></thead>
        <tbody>
          <tr><td>Recurring</td><td>Pool Cleaning</td><td>Base recurring charge</td><td>Recurring</td><td>$150.00</td><td></td></tr>
          <tr><td>Recurring</td><td>Pest Control</td><td>Base recurring charge</td><td>Recurring</td><td>$45.00</td><td></td></tr>
          <tr><td>Recurring</td><td>Landscaping</td><td>Base recurring charge</td><td>Recurring</td><td>$90.00</td><td> </td></tr>
        </tbody>
      </table>
    `;
    const labeled = addTableDataLabels(html);
    assert.equal(labeled.match(/data-label="Amount"/g)?.length, 3);
    assert.equal(labeled.match(/data-label="Type"/g)?.length, 3);
    assert.equal(labeled.match(/data-label="Invoice"/g)?.length, 3);
    assert.equal(labeled.match(/<td hidden data-label="Invoice">/g)?.length, 3);
    assert.match(labeled, /data-label="Amount">\$45\.00/);
    assert.match(labeled, /data-label="Vendor">Recurring<\/td><td data-label="Amount">\$90\.00/);
  });
});
