# Mobile-first UI/UX standards

## Standing product direction

SAS is a mobile-first accounting workspace. Start with the phone task and enhance
the layout for larger screens. Use charcoal text, quiet gray surfaces, white panels,
and restrained teal/green accents. Use clear hierarchy, consistent spacing, purposeful control
widths, and concise labels. Avoid generic oversized controls and decorative clutter.

The user's clarified direction is a simplified, data-first accounting system,
not a decorative website. Prioritize readable records, aligned amounts, useful
information density, compact controls, and restrained visual treatment. The supplied
Bills/register references guide practical data organization, not a request to copy
their rounded styling or generous empty space. This direction takes precedence
over earlier decorative design inspiration.

The authorized 2026-11-21 visual overhaul follows the supplied Behance Xero
accounting wireframe for desktop and bookkeeping mobile concepts from Dribbble
for phones. This supersedes earlier visual styling while retaining the data-first
workflow. Use self-hosted Manrope, consistent semantic color tokens, restrained
rounded panels, compact aligned tables, readable totals, and orderly editors.
Visual tokens and shared presentation rules live in src/workspace-theme.css;
src/styles.css owns the established responsive layout and interaction mechanics.
The font's OFL license is included beside the local font asset. Keep font loading
independent of Google or other third-party requests at runtime.

Phone navigation has Home, Disburse, Billings, Collect, and More. Aging, Reports,
and Settings stay directly reachable in More; highlight More on those routes,
support Escape/outside dismissal, and keep all desktop links. Phone cards group
reference/status, client, transaction number/category, date/total, and actions.
The card layout remains active below the 900px sidebar breakpoint, including
phone landscape and tablet widths, so rotation does not force horizontal table
scrolling. Larger desktop widths retain dense tables.
New module navigation starts at the top and focuses main content; browser Back
and Forward keep native scroll restoration. Opening or closing an editor must
not reset register position.
Never substitute sample metrics or decorative charts for actual accounting data.

The earlier **Facebook for iOS 588.0.0 (2026)** reference is historical context.
The current visual references are the accounting and bookkeeping concepts above.
Do not claim a match to any particular third-party app version without inspecting
that version. The iPhone XS keyboard regression target remains mandatory.

Read this document alongside the coding, architecture, security, and testing
standards. Presentation changes must preserve authorization and financial rules.

## Phone interaction

- Check new or changed layouts at 320px and 390px, then tablet and desktop widths.
- Keep primary tasks reachable with touch; use at least 44px touch targets on
  phones. Desktop controls may remain compact.
- Use readable form text, including 16px input text on phones to avoid automatic
  zoom when focusing fields in iOS browsers.
- Avoid document-wide horizontal overflow. Primary phone registers use compact
  record cards with identity, status, essential details, and actions visible.
  Retain the same requested rows and table semantics for assistive technology;
  do not fetch a second dataset for the phone layout. Dense comparison/report
  tables may scroll within their own region when that is essential to the task.
  Never hide essential data or actions just to make it fit.
- Keep filters compact and grouped logically. Do not make users scroll through
  an oversized filter stack before reaching their records.
- Test with long names, empty results, loading, errors, and multiple pages. Avoid
  trapping vertical touch scrolling inside unnecessarily small nested regions.

## Forms and dialogs

Create/edit actions must open a focused dialog or a dedicated view immediately.
Never append an editor below a table. Preserve list position and return focus to
the launcher on close. Keep important actions visible while long dialog content
scrolls, and account for small viewports and the on-screen keyboard.

Keep visible labels, native input types, readable errors, keyboard navigation,
and screen-reader names. Protect unsaved form changes when closing and prevent
duplicate submission or closing during a save/post request. A posted financial
record remains immutable regardless of layout.

### Searchable selection

Use the shared `SearchSelect` combobox for selection controls. Clicking or using
Arrow keys opens the dropdown; users type in that same field to filter options,
choose with touch/click or Arrow keys + Enter, and dismiss with Escape or Tab.
Free text never becomes a selected record. Preserve the chosen label when a
search is dismissed. Use compact controls, 44px phone targets, bounded option
scrolling, clear loading/empty/error states, and retry inside the dropdown.

For remote clients and disbursement sources, open/search/navigation requests only
one server page of 25 options; debounce typing and abort/ignore stale responses.
Do not preload every client or prefetch unrequested pages. Locally available small
option sets (branch context, status, roles, page size) filter their existing data.
Inside dialogs option lists float in the native top layer, anchored to their
field, without expanding the form, resizing the modal, or being clipped by its
scroll container. Fit the list above or below the field using the visible
keyboard viewport; reposition on dialog scrolling, resizing and orientation
changes. Preserve typing focus, bounded option scrolling, Escape/outside-click
dismissal, and searchable selection. Header/pagination menus retain their anchors.

Billing starts by choosing a client and pulling its disbursed (posted) transactions
from a searchable dropdown before entering invoice details. Display reference,
release date, and available balance. Exclude entries already selected from the
server query before counting/paging, and exclude fully allocated sources. Partial
posted allocations leave the remaining balance eligible for another billing.
Removing an unsaved link makes the source selectable again. The billing screen
requires at least one source to save; existing incomplete drafts remain readable
and can be completed. Database posting remains the final authority on balances.

### Keyboard-open regression target

On 2026-11-19, the user reported that Chrome on a physical **iPhone XS** covered
the Description field while editing a disbursement. Keep this device/browser and
flow as a standing regression target for every form/dialog change. Viewport units
alone do not establish that the focused field is visible with the keyboard open.
The user subsequently confirmed the shared-dialog fix worked on that device;
new forms still require their own keyboard-open acceptance check.

Shared dialogs follow VisualViewport height and offsets, compact their header when
visible space is limited, and scroll the focused field within the dialog above
sticky actions. Preserve browser zoom and form values; do not work around keyboard
obstruction by disabling zoom or locking the user out of scrolling.

Verify first and last inputs, textareas with multiple lines, numeric/date inputs,
switching focus, opening/dismissing the keyboard, orientation changes, and Save/Close
reachability. Check that the input, caret, and typed text remain visible. Include
error and unsaved-change states. Record physical-device testing separately from
automated viewport simulations, and explicitly identify a pending device retest.

## Registers and performance

Periodic access checks and returning to the app must stay quiet when the current
account's profile and scopes are unchanged. Preserve their references across
equivalent replies, including reordered scopes, so branches and registers do not
reload or flash loading states. Coalesce overlapping checks for the same account
and token, while checking changed tokens immediately. Keep the security refresh
interval, actual permission updates, recovery, sign-out, and failed-access guards.
Ignore session lookups and access replies superseded by newer auth events, so a
late background response cannot restore stale account state after sign-out.

Request only the selected server page with a bounded page size. Do not load an
entire dataset to paginate or filter it in the browser. Avoid unrequested page
prefetching. Load related detail data when its detail view is requested, while
preserving complete data wherever a privileged edit depends on it.

Debounce typed search, cancel superseded requests, and reject stale responses.
Use stable ordering ending in a unique ID. Reset to page one after changing a
filter or page size; recover when a page disappears. Show accurate row ranges,
clear empty/error states, and correctly disabled pagination controls.

Transaction registers default to the current release year in **Asia/Manila**.
Combine year, status, branch, and reference filters on the server. Compare date
boundaries directly so indexes remain usable. Choose indexes from actual query
patterns, not from the mere presence of a UI filter. Measure before introducing
cursor pagination, caching, virtualization, or additional indexes. Exact counts
and deep offsets have costs; do not claim large-scale performance without evidence.

## Completion and continuity

Inspect existing components and reuse them before adding dependencies. Document
durable user preferences here or in AGENTS.md when they change. Keep local setup
cross-platform with the standard npm commands and .env.example.

Run checks appropriate to the change and visually inspect affected phone and
desktop flows. Distinguish local fixtures, automated tests, and live verification
in reports. Commit with a meaningful summary and description, push, and report
the deployment status when deployment is part of the authorized work. Do not
claim complete mobile coverage from a check of one screen.

## Aging report

Aging is an as-of report across all outstanding invoice years, not a transaction
register limited to the current year. Default the report date to today in
Asia/Manila, apply typed dates explicitly, and label results with the applied date.
Group rows by branch/client; return one requested page and whole-filter totals in
one server response. Clearly distinguish overlapping cumulative thresholds from
Total A/R. A threshold filter selects matching clients while preserving their full
receivable. Loading/errors must not display stale totals as current or invent zero.

Reuse phone cards with every aging column and derived remarks. Keep Total A/R
visible, with duplicated bucket summary totals expandable on phones; desktop shows
all totals. Put pagination below the table or phone cards, in normal flow without covering
record values. Stack filters when side-by-side inputs become too
narrow to read. Never fetch another dataset for the mobile representation.

## Confirmation, notifications, and workspace header

All transaction confirmation decisions (posting, discard/cancel, or continuing
with unsaved edits) use a separate modal alert dialog. Focus the safe action,
trap focus natively, restore it when dismissed, and prevent duplicate submissions
or dismissal during a request. Never append a confirmation panel inside a form
or register. Use the shared ConfirmationDialog.

Action outcomes, saved messages, and rejection/error notifications use the shared
PopupNotice floating popover, including inside modal editors. They must be
dismissible, announced accessibly, and must not shift page content or steal typing
focus. Keep field labels, persistent access/setup guidance, loading indicators,
and dropdown empty/error states in context; those describe the current view.

The workspace header stays pinned while the page scrolls on phone, tablet, and
desktop. Keep branch selection menus above content and dialogs above the header;
check small-height/orientation and keyboard behavior. Preserve native document
scrolling and bottom mobile navigation.

## Filter congestion regression (2026-11-20)

The user reported overlapping Status/Release year controls, an iOS Report date
colliding with Apply, oversized heading action stacks, and pagination covering
phone records. Check the rendered SearchSelect wrapper rather than targeting the
plain select/label markup it replaced. Assign explicit grid positions and allow
zero minimum widths; date controls must fit their own track without relying on
native iOS intrinsic sizing. On the narrowest phones, give dates their own row.
Year filter labels wrap their input, so never add an outside bottom margin to
those labels: it lifts the input above the adjacent Apply button. Keep both
controls aligned at the top and bottom, including Release/Billing/Received year.

Phone registers and Aging keep search visible, reveal secondary controls with
Filters, and show the applied year/status or report date/threshold even while the
controls are collapsed. Expanding filters alone must not fetch or reset results.
On desktop, A/R Aging and Collections show Search and the filter fields together
in a toolbar directly below the workspace header. The toolbar stays in normal
document flow and keeps the currently applied report context visible.
Keep heading actions in a separate row when needed instead of squeezing the title.
Pagination appears once, in DOM order below the results, on desktop and mobile.
This placement follows the user’s latest preference and replaces the earlier
before-results layout.
Keep it in normal flow; never float a pager over records or add a second sticky
bar below the pinned header. Dropdown options open into the result region.
Apply these checks to transactions, organization, users, Aging, and sync history.

Page-size selectors must display all three digits of `100` while retaining a
44px phone dropdown target. Reserve separate space for the value and toggle; do
not shrink the input to fit an arbitrarily narrow outer control. Verify 25, 50,
and 100 at 320px and iPhone XS widths, including dropdown search and selection.

## Data-first workspace refresh

Use a restrained light sidebar with clear active navigation, a compact pinned
header, concise page titles, and consistent alignment. Remove marketing banners,
numbered decorative tiles, oversized heading text, and repeated workspace slogans
from operational screens. The home and settings screens are compact directories
of existing modules, not promotional landing pages or fabricated metric dashboards.

Desktop registers prioritize useful visible rows, readable column headings,
tabular amounts, concise secondary text, and direct actions. Phone records retain
all values and accessible table headers, with less card padding and fewer repeated
visual labels. Keep 44px touch targets, 16px phone fields, complete page-size values,
searchable selectors, scoped server paging, and visible applied filters.

Editors use concise headers and restrained borders, preserving field guidance,
keyboard-aware scrolling, sticky actions, unsaved-change protection, and pop-up
confirmation/feedback. Visual simplification must not hide errors or alter financial
rules. Review the visual result with the user; passing automated checks does not
establish design acceptance or physical-device keyboard acceptance.

## Configuration-driven entry forms

Where an active configuration defines transaction fields, show those fields
without making users add them individually, in both create and edit flows.
Preserve existing values during setup reloads. Unused manual amounts may stay
blank/zero; inactive saved items with values need explicit resolution before save.
This applies across modules where configuration-driven fields exist. Billing uses
the frozen posted source breakdown automatically, rather than substituting current
client setup or adding items one at a time. Source selection and invoice-only
corrections remain deliberate user choices.

## Accounting amount and category presentation

Disbursement and billing headline amounts use Total Payable and Invoice Total;
collections show the total received. Gross is an item in the breakdown and must
never stand in for the transaction total. Billing/collection Category columns
inherit the linked release categories, preserving multi-category invoices.

Aging labels the client balance Outstanding receivables, and keeps its included unpaid
Admin/Service Fee visible on phones as well as desktop. Explain proportional fee
allocation and legacy Not itemized values through an information disclosure;
never add the displayed fee to the already inclusive payable balance.
