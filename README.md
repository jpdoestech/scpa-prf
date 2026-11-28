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

- The super admin assigns branches to supervisors and HRD. In **Users**, supervisors and HRD can change employee branch membership within their own branches. Assignments outside their scope stay in place.
- Super admins can use **Users → Manage account → Delete account** to remove a user’s Supabase sign-in, PRF profile, and avatar. Super-admin accounts and accounts linked to PRF history are protected from this action.
- **Users → Manage PRF records** lets super admins delete selected PRFs or all matches for a day, month, or year by Manila submission date. Deletion removes the matched PRFs, their history, and queued sync entries. Copies already exported to files or Google Sheets are separate.
- Employees submit requests for their assigned active branches. Each request routes to a supervisor and HRD approver assigned to that branch. The app uses eligible staff overrides, branch defaults, or the only eligible approver for each stage. If a branch has multiple eligible approvers and no applicable default or override, the administrator must resolve the routing.
- In **New request**, select the **Branch**, **Position title**, and **Assigned area / store**. Staff with active PRF access can add missing positions and areas. The selected branch describes the request. Approval routing follows the requester's staff profile.
- Only super admins can manage branches under **Users → Request options**. Super admins, supervisors, and HRD can rename, deactivate, reactivate, or delete position titles and assigned areas under **Request options**. On phones, use the row’s **Actions** button. Confirm changes before saving. Inactive entries are hidden from dropdown choices. Existing requests keep their saved values, and branches with staff or approvers assigned can be deactivated.
- Returning or disapproving requires a reason. A returned request can be revised and resubmitted. Resubmission restarts supervisor review and keeps the full decision history. A disapproval closes the request. New requests receive their PRF number at final approval. Previously issued numbers stay with their requests. Request lists show the newest submissions first.
- Super admins can enable **Allow approval override** per Supervisor or HRD account under **Users**. An enabled approver can use **Eligible for override** in the **Approval inbox** to approve an urgent assigned PRF within their branch scope. An override records the approving role, the skipped step, and the required reason in the timeline.
- Decisions are recorded in Philippine time in the interface and spreadsheet. The database stores timezone-aware timestamps. The schedule, assignment, and requisition type follow the PRF. Salary, allowance, and qualifications are optional.
- Select **A4** or **Letter**, then choose **Print/Export PRF** to open the preview. Choose **Print**, **Download PNG**, or **Copy image** in the preview. On Chrome for iPhone, you can use **Share → Print** while the preview is open. For printing, select the same paper size, use 100% scale, and turn off browser headers and footers if shown. The form has a built-in 14 mm inset and includes approval times, the request timeline, the system-generated notice, and a Manila timestamp.
- The spreadsheet contains a summary row per submission, resubmission, approval, return, and disapproval. Approval comments, replacement details, qualifications, salary, and allowance remain in Supabase.

## Set up Supabase

1. Create a Supabase project and link the checkout with the Supabase CLI. Run `supabase db push` to apply the migration. Alternatively, run the migration in the project's SQL Editor.
2. Enable email sign-in and disable public sign-ups. The PRF super administrator creates every account with email and password. See the [production setup guide](SUPABASE-SETUP.md).
3. Adapt `supabase/provision-example.sql` to create branches, enable staff, and configure the routing. Creating a Supabase Auth account and adding an active `staff` row are both required. To remove access, set `staff.active = false`. Existing requests keep their assigned approvers and require a deliberate reassignment if an approver leaves.

Employees follow updates in **My requests**. Supervisors and HRD check **Approval inbox** for requests awaiting a decision. The browser only reads requests and timelines it is allowed to see. PostgreSQL functions validate mutations, enforce stage order, and record a delivery item in the same transaction as the action.

When an employee resubmits a returned PRF, the timeline shows the **From** and **To** values for each changed field. The same history appears in the print and export preview.

The **Approval inbox** badge counts requests currently awaiting your decision, across all inbox views. Use the separate status filter to find requests assigned to you at either review stage or with an Approved, Returned, or Disapproved outcome. **Compact** controls table and pagination density. The request tables remember your page size and density in the current browser.

Open **My account** from your profile button to update your display name, profile picture, or password. Password changes require your current password. The sign-in email is displayed for reference.

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
