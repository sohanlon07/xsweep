# Tweet Cleaner extension

This is the Manifest V3 replacement under development. It keeps archive data, queues, and attempts in the browser's local IndexedDB and requests access only to `x.com` and `twitter.com`.

## Browser discovery

Connect an X tab, then choose **Discover history**. The extension visits your profile, replies, and Likes pages in that tab. Each category has its own limit (0 skips it, maximum 1000), with at most 600 scrolls per category. Cancellation retains results already saved. Discovery and cleanup share an exclusive run lock. The connected X tab is brought to the foreground for loading. Leave it open until Chrome shows the completion notification. Discovery waits about 45 seconds without new matches before reporting stalled loading. Both profile Likes and the redirected `/i/history/likes` route are supported.

Results are always partial: X may stop loading, restrict a page, or present a challenge. The dashboard reports the stopping reason. Discovered items are unselected and merged with the existing queue without replacing its selection or progress. Like and repost action dates remain unknown. Review the queue before execution. Browser discovery has fixture coverage but still requires read-only acceptance against the live X interface.

The review queue labels tweets, replies, reposts, and likes separately and shows counts for the current preview. Optional start/end dates are inclusive. When a date filter is active, items with unknown action dates are hidden and excluded unless **include unknown action dates** is selected.

Select individual rows or use **Select all visible** after applying filters. Column headings sort the preview. **Preview selected** performs read-only inspection; **Execute selected actions** shows the account and irreversible-action confirmation before starting live changes.

## Build commands

```sh
npm install
npm run check
npm test
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`.

Open a normal signed-in X tab, use the extension icon to open the dashboard, connect that tab, import an archive, review individual targets, and use the default dry run first. Live actions require an explicit confirmation and should be tried only with user-approved disposable posts.

This package does not import cookies, use an X API credential, automate login, or resume mutations after a dashboard/tab interruption.
