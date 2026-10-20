# Browser tests

Use the Bun version in `package.json` and configure the application in `.env`.
Install the Playwright browser versions matching the locked dependency:

```sh
bun install --frozen-lockfile
bun run test:e2e:install
```

Run the instant-navigation suite with the single Playwright config:

```sh
bun run test:e2e
```

Playwright first builds the application with `NEXT_INSTANT_TEST=1`, then starts
that production artifact on port 3100. Both commands receive the same environment,
so the isolated `.next/instant-test` build includes the instant testing API.
No manual build or existing server is required. Port 3100 must be available.

The suite uses Playwright's bundled Chromium; a system Chrome installation is
unnecessary. Its selected links include desktop sidebar and hover interactions.

The instant suite requires the public events and subcategories named in
`instant-navigation.spec.ts`. Its `INSTANT_NAV_*` environment variables can select
matching fixtures in another test database.
