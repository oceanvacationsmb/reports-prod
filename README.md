# Ocean Vacations

Single React/Next.js system that replaces the legacy Reports and Owner Portal apps with serverless route handlers, MongoDB Atlas storage, Guesty proxy/cache, saved report links, Cloudinary invoices, and role-based admin/owner access.

## Quick start

1. Copy `.env.example` to `.env.local`.
2. Fill in `MONGODB_URI` and `JWT_SECRET`.
3. Optional: fill in Cloudinary credentials for invoice uploads.
4. Run `npm install`.
5. Run `npm run dev`.
6. Open `http://localhost:3000/login` and create the first admin user. Bootstrap is only allowed while the `User` collection is empty.

## Notes

- The browser never calls Guesty directly. `/api/guesty/reservations` and `/api/reports` fetch Guesty server-side and cache normalized rows in MongoDB.
- Cache TTL defaults to 30 minutes and can be adjusted in Admin Settings.
- Saved reports store HTML snapshots and can be viewed through shareable `/share/:shareId` links.
