# Browser tests

Use the Bun version in `package.json` and configure the application in `.env`.
Install the Playwright browser versions matching the locked dependency:

```sh
bun install --frozen-lockfile
bunx playwright install --with-deps chromium webkit
```

Run the instant-navigation suite with the single Playwright config:

```sh
bun run test:e2e
```

Playwright first builds the application with `NEXT_INSTANT_TEST=1`, then starts
that production artifact on port 3100. Both commands receive the same environment,
so the isolated `.next/instant-test` build includes the instant testing API.
No manual build or existing server is required. Port 3100 must be available.

The suite runs on Playwright's bundled Chromium and WebKit with desktop viewports.
Each browser covers hover, keyboard, touch, and direct visits without JavaScript.
A system Chrome or Safari installation is unnecessary.

To run one browser:

```sh
bun run test:e2e --project=chromium
bun run test:e2e --project=webkit
```

The instant suite requires the public events and subcategories named in
`instant-navigation.spec.ts`. Its `INSTANT_NAV_*` environment variables can select
matching fixtures in another test database.
