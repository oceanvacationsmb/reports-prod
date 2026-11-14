# Owner statement email, cron, and workbook

## What the Reports tab does

On the Reports tab, the statement batch:

- builds each owner’s statement as **Pending** (the same statement report as today)
- **Approved & Locked** saves that exact HTML on the existing `/share/:shareId` link
- a later change in the numbers creates a new version; the old link still opens the approved snapshot
- sends only when every current version for that month is Approved & Locked

Automatic sending is allowed only from **12:00 AM Eastern Time on the 1st** through **11:59 PM Eastern Time on the 3rd**, for the previous month. If anyone is still pending at the deadline, nobody is emailed and the screen says **“No statements were sent by the deadline.”** plus the names still waiting. Approvals after that stay held until **Send Statements to All Owners** is clicked. That button uses the same rules: it will not send a partial batch, and it will not send a version that already has a Gmail message id.

**Download All Statements** is one PDF of the approved snapshots. **Print All Statements** and **Print All Owner Summaries** open one print job. Summaries use the existing Owner Summary report for that month.

## Gmail (Ocean Vacations account)

Sending uses the Gmail API with OAuth. The refresh token is written to the `Setting` document `gmail-oauth` after you click **Connect Ocean Vacations Gmail**. It is not committed and it is not an environment variable.

1. In Google Cloud, create an OAuth client of type **Web application** for the Ocean Vacations Google account that should send the mail.
2. Enable the Gmail API.
3. Add the redirect URI `https://reports.oceanvacationsmb.com/api/gmail/callback` (or the value of `GMAIL_REDIRECT_URI`).
4. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI` on Vercel. Leave `GMAIL_SEND_ENABLED=false`.
5. Deploy, open Reports, and click **Connect Ocean Vacations Gmail**. Approve the send scope.
6. Set `GMAIL_SEND_ENABLED=true` and redeploy when you want real mail to go out.

Until that flag is true, a send records a failure and does **not** mark the statement Sent. Tests use a fake sender and do not call Google.

Each message goes only to that owner’s address and only contains that owner’s statement link. After Gmail returns a message id, the row stores the recipient, the time, and the id. A retry sees the id and does not send that version again.

## Cron limits

`vercel.json` schedules `GET /api/cron/owner-statements` at `55 3 * * *` (03:55 UTC every day). Set `CRON_SECRET`. Vercel calls the route with `Authorization: Bearer <CRON_SECRET>`.

That UTC time is about **10:55 PM Eastern Standard Time** and **11:55 PM Eastern Daylight Time** on the previous calendar date. The handler uses `America/New_York`:

- on the last calendar day, it generates that month’s Pending statements
- on the 1st, 2nd, and 3rd, it sends the previous month if every statement is approved
- on the 4th, if any are still pending, it records the deadline message; if they were approved too late, it holds them for the manual button

Vercel Hobby allows one cron invocation per day. This schedule stays inside that limit. An approval after the nightly run on the 3rd (after 10:55 PM EST, or after 11:55 PM EDT) is not auto-sent; use the manual button. A Pro plan could add a second daily run closer to midnight, but it is not required.

The cron route does not send mail unless Gmail is enabled. It never files a tax return.

## Workbook

A web app cannot silently edit a spreadsheet on a PC. The practical free approach is:

1. Map the sheet and columns once (owner, month, property, owner payout, cleaning transfer).
2. Each month, upload the `.xlsx` file.
3. The app writes only the matched payout and cleaning cells from finalized statements and downloads the updated file.

Excel and OpenOffice Calc both open `.xlsx`. Saving the owner’s workbook as `.xlsx` is what lets the app keep formatting, formulas, and every cell it was not asked to change. `.ods` is not updated in place; Calc can save a copy as `.xlsx` first.

Matching is owner + month + property. A second run updates the same cells and does not add a row. Unmatched statement lines and ambiguous rows are listed and left unchanged. A cell that already contains a formula is not overwritten.
