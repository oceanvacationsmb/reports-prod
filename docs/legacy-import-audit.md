# Legacy Owner Import Audit

Source files inspected:

- `/Users/leeoniisrael/Desktop/Aba/reports/data.json`
- `/Users/leeoniisrael/Desktop/Aba/reports/BACKUP DATA.JSON`

Import script:

- `npm run import:legacy`
- Script path: `scripts/import-legacy-data.js`
- Last generated machine report: `tmp/legacy-import-report.json`

## Owner Coverage

`data.json` contains 18 owner records. `TAX REPORT ONLY` is a utility/reporting record and was removed per user request, so 17 real owners are present in MongoDB.

The backup file contains 13 owners. Its only owner not named exactly in `data.json` is `508/1-2  - KOBI`; this was treated as an older alias of `KOBI - 508-1-2` because the newer owner exists in `data.json` and has the same email.

No real source owner was omitted.

## Imported Owners And Guesty-Derived Properties

| Owner | Property Count | Properties | Import Status |
| --- | ---: | --- | --- |
| 113-13 - CARL | 1 | GCSSB - 113B-13N | OK |
| 113-15 - MAT | 1 | GCSSB - 113B-15S | OK |
| 115C-15 - CHRIS | 1 | GCSSB - 115C 15N | OK |
| 1463 - NICOLE | 1 | GC - 1463 | OK |
| 1552 - YEN | 1 | MB - 1552 | OK |
| 2131 - GSD INVESTMENTS | 1 | MB - 2131 | OK |
| 214 - GTI GROUP TAL | 1 | NMB - 214-2S | OK |
| 3104 - JACOB ZROYA | 3 | NMB - 3104-1; NMB - 3104-2; NMB - 3104-3 | OK |
| 4631/301 - ORIT | 1 | MB - 4631/301 | OK |
| 4679/204 - MORENA | 1 | MB - 4679/204 | OK |
| 469C - ASSAF | 1 | MB - 469C | OK |
| 7401 - ZVIKA ELYA | 1 | MB - 7401 #8 | OK |
| 827B - Jeff | 1 | GC - 827B | OK |
| ALL PROPERTIES | 40 | GC - 1211A; GC - 1463; GC - 601A; GC - 601B; GC - 827B; GCSSB - 113A-12S; GCSSB - 113B-12S; GCSSB - 113B-13N; GCSSB - 113B-15S; GCSSB - 115C 15N; GCSSB - 204-2D; MB - 1552; MB - 2000; MB - 209/5112; MB - 209/5113; MB - 2131; MB - 4631/301; MB - 4679/204; MB - 469C; MB - 4765; MB - 7401 #8; MB - 7500; MB - Tuscan A; MB - Tuscan B; MB - Tuscan C; NMB - 1004; NMB - 204-27N; NMB - 204-28N; NMB - 214-2S; NMB - 304B; NMB - 3104-1; NMB - 3104-2; NMB - 3104-3; NMB - 400A; NMB - 400B; NMB - 508/1-33S; NMB - 508/2-33S; NMB - 703-2; NMB - 705-2; NMB - 709-2 | OK |
| ERAN MARON | 16 | GC - 1211A; GC - 601A; GC - 601B; GCSSB - 113A-12S; GCSSB - 113B-12S; MB - Tuscan A; MB - Tuscan B; MB - Tuscan C; NMB - 1004; NMB - 204-27N; NMB - 204-28N; NMB - 304B; NMB - 400A; NMB - 400B; NMB - 703-2; NMB - 709-2 | OK |
| GHO REVOCABLE TRUST | 6 | GCSSB - 204-2D; MB - 2000; MB - 209/5112; MB - 209/5113; MB - 4765; MB - 7500 | OK |
| KOBI - 508-1-2 | 2 | NMB - 508/1-33S; NMB - 508/2-33S | OK |

## Other Imported Data

- Properties: 42 MongoDB property records
- Vendors: 15 MongoDB vendor records
- Expenses: 187 unique MongoDB expense records from 192 legacy rows

The expense count is lower than the legacy row count because the importer uses a fingerprint to avoid duplicating exact repeat rows during reruns.

## Removed Utility Record

`TAX REPORT ONLY` was removed per user request. Its stored `guestyAllPropertiesUrl` returned `ERR_REPORT_NOT_FOUND`, and it is not treated as a real owner to import.
