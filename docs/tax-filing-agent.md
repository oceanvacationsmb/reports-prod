# Tax filing executor

The app prepares each month’s portal returns and stops at an approval gate. Nothing is filed or paid until someone clicks **Approve and File**. In this version that click calls a stub. The stub records the approval and does not open a portal, submit a return, or move money.

No portal password, bank account, or MFA secret is stored.

## What each portal actually supports

Checked November 2026 from the public pages below. None of the four portals publishes an API this app can call.

| Portal | What the public site says | Practical access |
| --- | --- | --- |
| SC MyDORWAY | [mydorway.dor.sc.gov](https://mydorway.dor.sc.gov/_/) and [dor.sc.gov/mydorway](https://dor.sc.gov/mydorway/). Login uses a password plus at least one more factor (authenticator app, phone, or email), or passwordless login with two factors. Accommodations returns are filed in the browser. A zero month is still filed. | Browser session behind MFA. |
| MyDORWAY Sales XML | [Sales XML Program](https://dor.sc.gov/sales-use-tax-index/sales-tax/sales-xml-program) can file ST-3/ST-389 and ST-388/ST-3T/ST-389. New certified-vendor enrollment is suspended until January 2027. Existing certified software can still file, and a taxpayer can upload XML inside MyDORWAY after SCDOR approves the filer application. | Not a free API we can turn on. Certification is closed to new vendors until 2027. |
| Horry County | [Business license online filing](https://www.horrycountysc.gov/business-license-online-filing/) points at the self-service site [service.horrycounty.org/css](https://service.horrycounty.org/css). The county’s [how-to PDF](https://www.horrycountysc.gov/media/bwvnimap/how-to-enter-filings-and-pay-online.pdf) says: log in, enter gross receipts, review, file, then pay by e-check (no county fee) or card (2%). The guide shows payment details being entered at checkout. | Browser session. A saved bank account was not confirmed on the public guide. |
| Myrtle Beach | [portal.cityofmyrtlebeach.com](https://portal.cityofmyrtlebeach.com/) is a login for an existing business-license or hospitality account. | Browser session. No public API. |
| North Myrtle Beach | [northmyrtlebeach.progressivecloud.net/webrenewals](https://northmyrtlebeach.progressivecloud.net/webrenewals/) is Progressive’s renewal site for business license and hospitality tax. | Browser session. No public API. |

## The in-app boundary

`lib/tax/filing.ts` defines `FilingExecutor`. `getFilingExecutor()` returns the stub. A future worker should implement the same interface:

- input: portal, period, one line per property (gross receipts and the statement’s taxes collected), and whether payment is required
- output: `submitted: true` plus a confirmation id, or `submitted: false` with a reason
- the app stores the confirmation and any uploaded receipt PDF on the Tax Report

`$0` gross is marked “No payment. Submit the zero return.” A positive gross tells the worker to use the bank method already saved in that portal. If the portal asks for a new account number, the worker must stop. This app will not store one.

## Options for the real executor

1. **Keep the stub and file by hand.** The review screen already has the property list and amounts. After filing, upload the portal confirmation. Cost: $0. This is the current behavior.
2. **A separate browser worker on a machine the owner controls.** Playwright (or the same Chromium already used for PDFs) runs outside Vercel, reads the prepared return from this app, and drives the logged-in portal. A small always-on computer or a $4–6/month VPS is enough. Vercel’s hobby/pro serverless functions are a poor place for this: logins, MFA, and multi-page payment flows take longer than a function likes to stay open, and a headless browser there is easy to break.
3. **MyDORWAY Sales XML only, later.** Worth another look after January 2027 if SCDOR reopens vendor certification, or sooner if Ocean Vacations already has a certified software subscription. That path still would not file Horry, Myrtle Beach, or North Myrtle Beach.

Paid browser farms (Browserbase and similar) can drive the same clicks. They are a monthly bill and another company holding a tax login, so they are a poor fit for the “no paid services” rule.

## What a browser worker would need

- Its own OS user on a machine the owner controls. Not a secret in this repo.
- Portal usernames. Passwords belong in that machine’s password manager, not in MongoDB.
- MFA. MyDORWAY wants an authenticator app, phone, or email. A worker can use a TOTP secret stored only on that machine, or stop and wait for the owner to approve a prompt. Do not copy that secret into Vercel.
- The prepared JSON from this app (an admin-only export or a signed read of the filing record).
- Permission to choose the bank account already saved in the portal. Horry’s public guide shows typing e-check details at checkout, so the worker may have to stop there until someone confirms the county account remembers a bank.

## Risks

- A portal redesign breaks the clicks. The worker should fail closed and leave the return unfiled.
- MFA prompts and “trust this device” cookies expire.
- A wrong gross receipt would be paid from the real bank account. The in-app approval gate stays in front of the worker.
- Account lockouts from repeated login attempts.
- Storing portal passwords in the Next.js app would put them on Vercel and in MongoDB. This PR does not do that.

## Owner decision

Choose one: keep filing from the review screen by hand, or run a separate browser worker on a machine you control. Sales XML is not available to a new filer until SCDOR reopens certification.
