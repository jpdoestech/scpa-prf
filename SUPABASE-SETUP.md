# SCPA PRF production Supabase setup

[Live app](https://scpa-prf.vercel.app/) · [Supabase project](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo)

## Accounts and sign-in

1. Keep **Allow new users to sign up** off and **Email** enabled. Use the Vercel URL as the Site URL. [Sign-in providers](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/auth/providers) · [URL configuration](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/auth/url-configuration)
2. The PRF super administrator creates every account, including HRD, supervisors, employees, and any other users. In **Authentication → Users → Add user → Create new user**, enter the user's verified email and a unique initial password. Select **Auto Confirm User** if shown. Give each user their password privately. [Auth users](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/auth/users) · [Admin account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
3. Enable each user in the PRF staff table and configure their branch and approval assignments. For the first employee, assign two distinct active users as supervisor and HRD. [Provisioning example](supabase/provision-example.sql)
4. HRD handles reset requests and verifies the employee's identity. The authorized PRF administrator uses the Auth user's UUID and Supabase's server-side `auth.admin.updateUserById(userId, { password: newPassword })` to set a replacement password in a trusted admin environment, then gives it privately to the employee. [Administrator password reset](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)

Employees sign in with email and password. **My requests** shows status, the next approver, and dated comments. Supervisors and HRD check **Approval inbox** for work awaiting them. The pilot requires no email service.

## Optional Google Sheets sync

The worker uses `PRF_SYNC_SECRET` and the matching `prf_sync_secret` in Vault. Vault also contains `prf_project_url`. [Edge Functions](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/functions) · [Vault secrets](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/integrations/vault/secrets)

1. Enable the Google Sheets API and create a service account key in JSON format. [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com) · [Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) · [Google service account instructions](https://developers.google.com/workspace/guides/create-credentials#service-account-credentials)
2. Set the spreadsheet to **Restricted** and add a blank **PRF Transactions** tab. Share the spreadsheet with the service account's `client_email` as an **Editor**. Keep the tab's row order intact so retries write to the same row. [Google Sheets](https://sheets.google.com/)
3. Save the entire JSON as `GOOGLE_SERVICE_ACCOUNT_JSON` and the ID between `/d/` and `/edit` in the spreadsheet URL as `GOOGLE_SPREADSHEET_ID`. The optional `GOOGLE_SHEET_TAB` defaults to `PRF Transactions`. [Edge Function secrets](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/functions/secrets)
4. Once the Sheets secrets are ready, install the once-per-minute schedule. Production already has the Sheets-only migration and the updated worker. [Sheets-only migration](supabase/migrations/202611270002_prf_sheets_only.sql) · [Schedule SQL](supabase/schedule.sql) · [SQL Editor](https://supabase.com/dashboard/project/crstiwhylwumglbjxwbo/sql/new)

## Production checks

- Migrations `202611270001` and `202611270002` were applied through the SQL Editor. Record both as applied in the CLI ledger before the next `supabase db push`. [Base migration](supabase/migrations/202611270001_prf.sql) · [Supabase migration repair](https://supabase.com/docs/guides/deployment/database-migrations)
- After provisioning, test all three sign-ins. Submit a labeled test request and exercise return, resubmission, and both approvals. Use a second test request for disapproval. Verify in-app status, permissions, and one-page printing in A4 and Letter. Check the transaction rows if Sheets sync is enabled. [Live app](https://scpa-prf.vercel.app/)
