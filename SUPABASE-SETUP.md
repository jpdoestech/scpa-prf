# SCPA PRF production Supabase setup

[Live app](https://scpa-prf.vercel.app/) · [Supabase project](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo)

## Accounts and sign-in

1. Keep **Allow new users to sign up** off and **Email** enabled. Use the Vercel URL as the Site URL. [Sign-in providers](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/auth/providers) · [URL configuration](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/auth/url-configuration)
2. Sign in as the PRF super administrator. Use **Users → Add branch** to add locations to the shared branch list. Open **Users → New user** to create the supervisor and HRD accounts first. Enter each user's verified email, name, role, and a unique initial password. Select their existing location from **Assigned branch**. Give each user their password privately. [Live app](https://scpa-prf.vercel.app/)
3. Create the employee and select their supervisor and HRD approver. The app creates the Auth account and active PRF profile together. Other staff can have both approvers assigned at creation if they will submit requests.
4. In **Users → Manage**, edit a user's PRF role, branch, assigned approvers, or access status. An inactive profile blocks PRF access and preserves the account and request history. An approver with active assignments must be reassigned before deactivation. The super-admin login opens **Users**, **My requests**, and **Approval inbox**. To submit or review requests, use **Set up my profile** to add your staff profile and configure the approval assignments.
5. HRD verifies password reset requests. The super administrator sets the replacement password in **Users → Manage → Password reset** and gives it privately to the user. Super-admin passwords are reset through the Supabase administrator. [Supabase admin password reset](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

Employees sign in with email and password. **My requests** shows status, the next approver, and dated comments. Supervisors and HRD check **Approval inbox** for work awaiting them. The pilot requires no email service.

## Optional Google Sheets sync

The worker uses `PRF_SYNC_SECRET` and the matching `prf_sync_secret` in Vault. Vault also contains `prf_project_url`. [Edge Functions](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/functions) · [Vault secrets](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/integrations/vault/secrets)

1. Enable the Google Sheets API and create a service account key in JSON format. [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) · [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) · [Google service account instructions](https://developers.google.com/workspace/guides/create-credentials#service-account-credentials)
2. Set the spreadsheet to **Restricted** and add a blank **PRF Transactions** tab. Share the spreadsheet with the service account's `client_email` as an **Editor**. Keep the tab's row order intact so retries write to the same row. [Google Sheets](https://sheets.google.com/)
3. Save the entire JSON as `GOOGLE_SERVICE_ACCOUNT_JSON` and the ID between `/d/` and `/edit` in the spreadsheet URL as `GOOGLE_SPREADSHEET_ID`. The optional `GOOGLE_SHEET_TAB` defaults to `PRF Transactions`. [Edge Function secrets](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/functions/secrets)
4. Once the Sheets secrets are ready, install the once-per-minute schedule. Production already has the Sheets-only migration and the updated worker. [Sheets-only migration](supabase/migrations/202611270002_prf_sheets_only.sql) · [Schedule SQL](supabase/schedule.sql) · [SQL Editor](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/sql/new)

## Automatic production deployment

1. Add the following as GitHub Actions **repository secrets**. Enter the values directly in GitHub. [Repository Actions secrets](https://github.com/jpdoestech/scpa-prf/settings/secrets/actions)

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token with access to the production project and permission to link, check the database, and deploy Edge Functions |
   | `SUPABASE_DB_PASSWORD` | The production PostgreSQL database password |

   [Supabase access tokens](https://supabase.com/dashboard/account/tokens) · [Supabase CI/CD setup](https://supabase.com/docs/guides/deployment/managing-environments)

2. In GitHub Actions, run **Deploy PRF to Supabase** from `main` with **record_existing_migrations** enabled once. Production migrations `202611270001` through `202611270005` were applied in the SQL Editor. The workflow checks the installed schema, records these versions as applied, and then runs the normal deployment. [GitHub Actions](https://github.com/jpdoestech/scpa-prf/actions/workflows/supabase.yml) · [Migration history repair](https://supabase.com/docs/reference/cli/supabase-migration-repair)

Future changes to Supabase migrations, functions, or function configuration pushed to `main` trigger deployment automatically. The workflow applies migrations before deploying Edge Functions. Vercel continues to deploy the frontend from GitHub.

## Production checks

- User administration uses the [PRF provisioning migration](supabase/migrations/202611270003_prf_admin_provisioning.sql) and the `prf-admin` Edge Function. Grant access only to a verified Auth account through server-managed `app_metadata.prf_super_admin`. Never use editable user metadata for this grant. Record dashboard-applied migrations in the CLI ledger before the next `supabase db push`. [Supabase migration repair](https://supabase.com/docs/guides/deployment/database-migrations)
- After provisioning, test all three sign-ins. Submit a labeled test request and exercise return, resubmission, and both approvals. Use a second test request for disapproval. Verify in-app status, permissions, and one-page printing in A4 and Letter. Check the transaction rows if Sheets sync is enabled. [Live app](https://scpa-prf.vercel.app/)
