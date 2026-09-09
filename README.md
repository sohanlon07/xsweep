# Tweet Cleaner

Tweet Cleaner is a local-first Chrome extension for reviewing and cleaning up your own X posts, reposts, and likes. It opens a full-page dashboard in your normal browser session; it does not use X API credentials, copy cookies, create a separate browser profile, or automate login.

Archive data, review queues, run progress, and action attempts stay in the browser's local IndexedDB. The extension requests access only to X/Twitter pages.

## Install from source

```sh
cd extension
npm install
npm run check
npm test
npm run build
```

In Chrome, open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `extension/dist`.

## Safe use

1. Sign in to X normally and open the tab you want to use for cleanup.
2. Open Tweet Cleaner from the extension icon and connect that tab.
3. Import your X archive, review individual targets, and run the default dry-run preview.
4. Explicitly select and approve only the actions you intend to make permanent.

The executor binds work to the reviewed account, tab, run, and target. It spaces completed live attempts by at least 20 seconds, stops on ambiguity or interruption, and never treats an unverified mutation as successful. It does not automatically resume destructive actions after the dashboard, tab, browser, or extension is interrupted.

## Development

The extension package contains its own build instructions, test commands, technical details, and current limitations: [extension README](extension/README.md).

Safari support and store publishing are separate distribution work; validate ordinary Chrome login and dry-run behaviour before live use.
