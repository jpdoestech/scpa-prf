# SCPA Personnel Requisition System

SCPA employees can submit agency personnel requests from a phone or desktop, see the next approver, and review the dated decision history. Supervisors and HRD officers can review an inbox or see all requests assigned to them. The PRF print button fills one SCPA-branded copy of the supplied form for A4 or Letter.

## Try the sample

Open the packaged `Demo.html` in a modern browser. Use **Demo role** to switch between Employee, Supervisor, and HRD. Sample activity stays in that browser. The demo has no production connections.

From the source checkout, use Node 22 and run:

```sh
npm ci
PUBLIC_DEMO=true npm run dev
```

Open http://127.0.0.1:4173. Set `PUBLIC_DEMO=true` only for sample builds.

## Approval and paper defaults

- An active employee sends one request to their assigned supervisor, then to their assigned HRD officer. Branch defaults can be overridden per employee. Routing is captured at submission for consistent review. The two approvers must be distinct and cannot be the requester.
- Returning or disapproving requires a reason. A returned request can be revised under the same PRF number. Resubmission restarts supervisor review and keeps the full decision history. A disapproval closes the request. HRD approval completes the workflow.
- Decisions are recorded in Philippine time in the interface and spreadsheet. The database stores timezone-aware timestamps. The schedule, assignment, and requisition type follow the PRF. Salary, allowance, and qualifications are optional.
- Select **A4** or **Letter** before choosing **Print PRF**. Select the same paper size in your browser, use 100% scale, and turn off browser headers and footers if shown. The form has a built-in 14 mm inset. Use the browser's **None** margin setting if it offers one. The page prints the requester's name plus approved reviewers' names and dates. Handwritten signatures can be added on paper if your office requires them. Long fields and qualifications are printed below the form when needed.
- The spreadsheet contains a summary row per submission, resubmission, approval, return, and disapproval. Approval comments, replacement details, qualifications, salary, and allowance remain in Supabase.

## Set up Supabase

1. Create a Supabase project and link the checkout with the Supabase CLI. Run `supabase db push` to apply the migration. Alternatively, run the migration in the project's SQL Editor.
2. Enable email sign-in and disable public sign-ups. The PRF super administrator creates every account with email and password. See the [production setup guide](SUPABASE-SETUP.md).
3. Adapt `supabase/provision-example.sql` to create branches, enable staff, and configure the routing. Creating a Supabase Auth account and adding an active `staff` row are both required. To remove access, set `staff.active = false`. Existing requests keep their assigned approvers and require a deliberate reassignment if an approver leaves.

Employees follow updates in **My requests**. Supervisors and HRD check **Approval inbox** for requests awaiting a decision. The browser only reads requests and timelines it is allowed to see. PostgreSQL functions validate mutations, enforce stage order, and record a delivery item in the same transaction as the action.

## Deploy the frontend

Push the source to your GitHub repository. Import the repository into Vercel. The supplied configuration runs the build and serves the static `dist` directory.

| Frontend environment variable | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Your HTTPS Supabase project URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key or legacy anon key |

For GitHub Pages as a second frontend, select **GitHub Actions** in the repository’s Pages settings. Create repository Actions variables with the same names and run **Deploy PRF to GitHub Pages**. Both hosts use the same Supabase data. [Vercel project configuration](https://vercel.com/docs/project-configuration) · [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Optional Sheets sync

1. Create a restricted spreadsheet and a blank tab named **PRF Transactions**. Enable the Google Sheets API for your Google Cloud project and share the spreadsheet with your Google Cloud service account as an Editor. Use filter views or report formulas in another tab. The integration owns row order and positions in the transaction tab. [Google service account authorization](https://developers.google.com/identity/protocols/oauth2/service-account) · [Google Sheets batch writes](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate)
2. Store the following values as **Supabase Edge Function secrets**. Keep all private keys out of the frontend, GitHub repository, and chat.

   | Secret | Value |
   | --- | --- |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Contents of the service account credentials JSON |
   | `GOOGLE_SPREADSHEET_ID` | Target spreadsheet ID |
   | `GOOGLE_SHEET_TAB` | Optional override for the transaction tab |
   | `PRF_SYNC_SECRET` | Random secret of at least 32 characters for the worker |

3. Deploy the worker with `supabase functions deploy sync-prf`. Add the Supabase project URL as `prf_project_url` and the same worker secret as `prf_sync_secret` in Supabase Vault. Run `supabase/schedule.sql` in the SQL Editor. Cron starts one worker per minute. [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions)
4. Submit a test request, return and resubmit it, then approve with the supervisor and HRD accounts. Check the PRF, timeline, and transaction sheet before inviting the whole company. Recent worker failures appear in `public.delivery_queue.last_error` for the database administrator.

The worker writes each event to a fixed row based on the event ID and retries failed deliveries. A Sheets outage can delay spreadsheet writes while request submissions and approvals continue.
