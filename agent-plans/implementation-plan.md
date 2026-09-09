# Tweet Cleaner: Extension-First Migration Plan

## Goal and scope

Replace the Go/Wails desktop application with a browser extension that opens a full-page Svelte dashboard. Users log into X normally in their browser, import an archive or discover visible history, review a queue, and explicitly approve cleanup of their own posts, reposts, and likes. Archive data and progress remain local. No paid API integration, copied cookies, separate browser profile, bundled Chromium, native messaging, or remote-debugging login handoff is required for the Chrome version.

Implementation baseline: Chrome Manifest V3, TypeScript, the existing Svelte/Tailwind UI, and IndexedDB. Keep browser integration behind a small adapter for a later Safari Web Extension port. Safari is important because it is the user's known-working X browser; Chrome login must be validated in ordinary Chrome before treating the Chrome prototype as solving the user's login problem. Safari packaging and permissions require separate verification and a containing macOS app for distribution; do not promise identical installation across browsers.

This is a migration, not a repository wipe. Preserve the existing implementation as a reference until the extension meets acceptance criteria. Earlier successful builds do not prove that the existing destructive executor or recovery logic is correct.

## Architecture

- Add an independent `extension/` package with a Manifest V3 build, a full-page dashboard, a service worker, an archive parsing Web Worker, an X content script, and shared TypeScript contracts. Keep the desktop build available during development.
- Reuse useful Svelte components, styles, and archive test cases. Replace Wails calls with extension messaging. Port parsing behavior with corrected validation; rewrite queue execution instead of copying the HTTP-oriented Go engine.
- Open the dashboard from the extension icon. The dashboard coordinates execution while open. The service worker handles browser events and message routing; do not rely on a permanently running background worker or timers surviving suspension.
- Use a dedicated cleanup tab in the user's ordinary browser session. The content script reads and operates that tab's DOM. Bind each run to its tab, authenticated account, and unique run ID. Restrict access to X; request only permissions necessary for scripting, tab operation, and local storage. Do not request cookie access or access to all websites.
- Store queues, run state, action attempts, and import metadata in versioned IndexedDB stores. Use transactions for state changes. Do not log credentials or persist raw page dumps. Render imported and page-sourced text as text, never HTML.
- Validate message types, sender context, tab ID, run ID, item ID, action, and account binding. Content scripts return observations; they cannot choose arbitrary new destructive work.

## Discovery, review, and execution

### Import and discovery

- Parse archive ZIPs locally in a Web Worker using a maintained ZIP library. Read recognized tweet/like data entries, including multipart exports; strip only known JavaScript assignment wrappers and parse JSON without evaluating archive code. Bound decompression and parsing resource use; report malformed or unsupported entries explicitly.
- Normalize IDs as decimal strings. Deduplicate by action and target ID. Preserve text, source, author/account metadata where available, and timestamps. Separate original post ID from repost record ID; unresolved targets must require review instead of guessing.
- Make archive import the recommended source. Optional browser discovery reads the signed-in user's profile, replies, and Likes pages with bounded scrolling, progress, cancellation, and separate category limits. Return partial-completeness reasons for limits, stalled loading, challenges, or unavailable pages.
- Extract the enclosing post's canonical timestamp permalink, author, and state; do not pick the first arbitrary status link or rely solely on English repost text. Exclude recommendations, promoted content, quoted inner posts, and unrelated authors from owned-post deletion candidates.
- Apply actual date/type filters before building the selected batch. Distinguish post creation time from the time a like or repost occurred. Display unknown action dates explicitly and exclude them from date-restricted batches by default, with an explicit inclusion option.
- Provide per-item selection, full-text inspection, source/type/date filters, counts by action, and queue export. Unknown or ambiguous items cannot silently enter an executable batch.

### Verified actions

- Dry run is enabled initially and performs read-only page inspection without clicking mutation controls. Store preview results separately so a later approved execution does not skip previewed items.
- Batch approval binds the selected account, item IDs, actions, and run revision. Changing the account or selection invalidates approval. Show the account, counts by action, and irreversible nature of deletion.
- Execute one item at a time. Validate the account, URL, exact target article, ownership for deletion, and current action state before any mutation. Scope controls to that article and the resulting specific dialog/menu; never search the entire page for a text substring.
- For deletion, open the target's menu, choose Delete, validate the confirmation dialog, and confirm. For unlike and undo repost, act only on positively identified active states. Already-inactive states produce an `already_done` result, not another click.
- Wait for positive post-action evidence tied to the same target. A click, disappearing button, timeout, or generic unavailable page alone is insufficient evidence of deletion. Uncertain outcomes become `needs_attention` and pause the run.
- Use 20 seconds minimum between completed attempts and the next attempt. Treat this as a product pacing default, not a guaranteed X rate limit. Stop for login challenges, throttling, account switches, unexpected navigation, or changed controls. Do not solve challenges, spoof browser identity, or rotate identities to evade restrictions.
- Discovery and cleanup cannot run concurrently in the execution tab. The user may use other tabs but must leave this tab available during the run.

## State, cancellation, and recovery

- Use explicit item states: `pending`, `inspecting`, `awaiting_confirmation`, `executing`, `verifying`, `succeeded`, `already_done`, `skipped`, `needs_attention`, and `failed`. Keep selected action and dry-run inspection results separate from execution state.
- Persist account binding, import fingerprint, source/filter settings, selected targets, schema/app version, attempt ID, last verified result, and next eligible execution time. Checkpoint immediately before a possible mutation and after its observed outcome; a storage failure pauses work before another mutation.
- Claim a single active run through an IndexedDB transaction so multiple dashboard tabs cannot start parallel workers. Use run/attempt tokens to reject late messages and stale results.
- Pause prevents new mutations at the next action boundary. Cancel invalidates the run and stops further clicks, including any pending confirmation. A click already accepted by X cannot be undone; record it as uncertain if its outcome cannot be verified.
- Dashboard closure, execution-tab closure, browser restart, sleep, or extension reload interrupts execution. A content script must require a live dashboard connection and valid attempt before every mutation; disconnect invalidates its permission to continue. Do not autonomously resume destructive work after interruption.
- On reopening, offer Resume, Export, or Discard. Recheck account identity and reconcile interrupted attempts by read-only inspection before any new action. Do not reset uncertain actions to pending and replay them blindly.
- Provide Retry inspection, Skip item, Open target, Resume, Cancel, and Clear local data. Resume after manual intervention rechecks the blocked target rather than simply advancing the loop or setting authentication true.

## Implementation milestones and acceptance

1. **Preserve and scaffold:** capture the current source in a reviewed Git baseline before deleting legacy code. Much of this repository is currently untracked; a branch alone does not preserve untracked files. Establish the independent extension build and reuse the Svelte layout.
2. **Read-only browser proof:** load the extension in the user's chosen normal browser, connect an existing X tab, display the verified account and exact post identity. Validate the login/session premise before building more destructive features. If Chrome login fails while Safari works, prioritize the Safari adapter instead of introducing another Chrome login workaround.
3. **Local product flow:** implement archive parsing, IndexedDB persistence, working filters, editable review queue, export, and optional bounded browser discovery. Validate large archives without freezing the dashboard.
4. **Executor:** implement target-scoped inspection and action adapters, durable attempts, interruption handling, and positive verification. Start with owned-post deletion, then add unlike and undo repost; all three are required for feature completion.
5. **Verification:** test malformed/multipart archives, duplicate IDs, unknown dates, repost target ambiguity, filtering, account mismatch, quoted posts/replies, already-completed actions, confirmation failure, cancellation between clicks, storage failure, browser/tab closure, restart reconciliation, and duplicate dashboard instances. Use DOM fixtures and a controlled local test site; never make routine tests mutate a real X account.
6. **Live acceptance:** first verify read-only discovery and dry run against the real X interface. Real deletions require explicitly selected disposable items approved by the user. Confirm each supported action and one interruption/recovery scenario before claiming working bulk cleanup.
7. **Retire desktop:** after acceptance, remove Wails bindings, Go runtime code, cookie/OAuth/API paths, CDP controller, bundled-browser downloader, and obsolete build configuration. Preserve useful fixtures and provenance. Rewrite README and build/release instructions for extension installation, supported browsers, local data handling, and known limitations. Store publishing and Safari distribution are separate release steps.

Completion means the extension works without the desktop runtime on its supported browser, never selects a different target, never reports an unverified mutation as success, honors reviewed filters/account binding, and resumes interrupted work without blind replay. Builds and unit tests alone are not live acceptance evidence.
