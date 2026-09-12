# XSweep

XSweep is a local-first Chrome extension for reviewing and cleaning up your own X posts, replies, reposts, and likes. It opens in Chrome’s persistent side panel beside the active X tab; it does not use the paid official X API, copy cookies, create a separate browser profile, or automate login.

Queue and run data is local to the browser, but is cleared whenever the extension is reloaded. Use **Export queue** before reloading if you need a record. The extension requests access only to X/Twitter pages and X's static asset host. It does not request Chrome's cookie permission.

The extension is currently in preview. Use disposable items for live testing until direct-request live acceptance is complete.

## Install from source

```sh
cd extension
npm install
npm run check
npm test
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `extension/dist`. After every install, rebuild, or extension reload, refresh the X tab so the direct capability handshake can be observed.

## User workflow

1. Sign in to X normally and open the correct account's profile in a dedicated tab.
2. Open XSweep from its extension icon. It connects to the active X tab automatically; if several X tabs are open, choose the intended one and verify the displayed `@handle`.
3. Confirm that **Direct X requests** are ready. If capability is unavailable, refresh X and use it normally briefly so the signed-in web request can be observed.
4. Import the original X archive `.zip` where possible. This is the recommended and most complete queue source. Alternatively, choose a time period, categories, and select **Discover selected history**; live discovery can be partial.
5. Filter the review queue and select only exact targets you recognize. Selections save automatically.
6. Run **Preview selected (read only)**. This checks each exact target without changing X.
7. Recheck the account, category filter, and selected count. Select **Run selected actions** to begin the reviewed batch immediately—there is no additional browser pop-up.
8. Keep the dashboard and connected X tab open until completion. Use **Cancel safely** to stop before the next mutation.

Direct requests avoid per-item navigation and normally use adaptive randomized 3–5 second pacing while X's reported rate-limit capacity is healthy.

The executor binds every mutation to the reviewed account, tab, run, attempt, action, and target. It stops on ambiguity, account changes, authentication problems, challenges, or unverified results. A dispatched action with an interrupted or inconclusive readback becomes `needs_attention` and is never retried automatically. Inspect it manually or run another read-only preview before deciding what to do.

Archive imports replace the current queue. Use **Start fresh** to clear saved queue/run history without changing X, or **Export** first if you need a JSON backup. Cancelling discovery retains already saved partial results until you start fresh or reload the extension.

## Detailed usage

### Connect

The XSweep side panel connects to the active X tab automatically. If several X tabs are open, choose the dedicated tab for the account you want to clean. Confirm the displayed handle and that Direct X requests are ready.

If capability is unavailable, refresh the X tab and use X normally long enough for its page requests to run, then choose **Try again**. The `?` tooltip beside X session explains what capability checks. Never paste cookies, bearer tokens, or other credentials into XSweep.

### Add items to the queue

For the recommended archive workflow, choose the original X archive `.zip` under **Import archive**. It is processed locally. Archive timestamps provide the most reliable date filtering, although like and repost action dates can still be unknown.

For live discovery, choose **All history**, **Last 24 hours**, **Last 7 days**, **Last 30 days**, or a custom inclusive date range. Select the categories to include, then choose **Discover selected history** and leave the connected X tab open until it finishes or you select **Cancel discovery**. The date scope uses post creation dates; like and repost action dates remain unknown during review.

Direct discovery reads cursor-paginated batches without navigating the tab. Each run replaces the queue with only its selected categories: posts, replies, or the combined likes-and-reposts option. It stops safely if X repeats a cursor or page content, or stops producing new targets. Results can still be partial if X throttles requests, changes its structure, or presents a challenge; the completion message reports why each category stopped.

### Review and preview

The date scope is chosen during discovery. In the review queue, filter by category and select only exact items you recognize. Ambiguous rows cannot be executed automatically.

Use **Select all visible** only after checking the active filters. Selections save automatically. **Export** downloads a JSON backup of the current queue and its states.

Run **Preview selected (read only)** before every live batch. Preview inspects exact targets but performs no mutation. An active target is marked `skipped`, while a target already deleted, unliked, or unreposted is marked `already_done`.

### Execute and cancel

Recheck the account, category filter, and selected count. Select **Run selected actions** to start the reviewed batch directly; there is no extra browser confirmation. Keep the side panel and connected X tab open until completion.

Actions run sequentially. Success requires an accepted operation-specific response and verification of the exact target. Direct mode shows X's request allowance and reset time when X provides them.

Select **Cancel safely** to prevent the next action. If cancellation, a network failure, tab closure, extension reload, or dashboard closure occurs after dispatch but before verification, the item becomes `needs_attention`. Inspect it manually or run a new read-only preview. XSweep never retries an uncertain mutation automatically.

### Queue states

- `pending` — available for review and selection.
- `inspecting` or `executing` — currently being processed.
- `skipped` — preview confirmed the target was active; nothing changed.
- `succeeded` — the requested action and exact-target readback were verified.
- `already_done` — the requested end state already existed.
- `needs_attention` — identity, authentication, page structure, throttling, or verification requires manual review.

After an interrupted run, reopen or refresh the correct X tab, reconnect, inspect every `needs_attention` item, and create a new reviewed batch. Unfinished work is not replayed automatically.

## Troubleshooting

- **No X tabs found:** open `https://x.com` in the browser profile where XSweep is installed.
- **Could not identify the account:** sign in normally, let X load, refresh the tab, and choose **Try again**.
- **Direct capability unavailable:** reload the extension, refresh X, and browse within X briefly, then choose **Try again**.
- **Login or challenge shown:** stop and resolve it manually in X. XSweep does not bypass challenges.
- **Another dashboard owns an active run:** close duplicate dashboards, reload, and reconcile the saved queue before starting another batch.
- **Item needs attention:** do not immediately retry it. Check the exact item on X or use the read-only preview.
- **Dashboard must be opened from an installed extension:** rebuild, load `extension/dist`, and use the extension icon.

## Privacy and permissions

XSweep does not log in for you, bypass challenges, retrieve or persist `auth_token`, use the paid official X API, send telemetry, or fetch executable configuration from third parties.

In direct mode, observed web-client headers and the CSRF value needed for an X request remain ephemeral inside the connected X tab. They are not included in IndexedDB, logs, or queue exports.

## Development

Run checks from the repository root:

```sh
cd extension
npm run check
npm test
npm run build
npm audit --omit=dev
```

Safari support and store publishing are separate distribution work; validate ordinary Chrome login and dry-run behaviour before live use.
