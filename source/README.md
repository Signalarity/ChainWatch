# Chainwatch: local computation, public GitHub Pages results

The collector runs on the publisher’s computer. A public GitHub Pages dashboard reads the last published snapshot. The computer needs outbound internet access only; no node RPC or inbound router port is exposed. Visitors cannot initiate scans, add addresses, or access the local database.

## Requirements and setup

Use Node.js 24 or newer and Git. Run `npm ci` and `npm run build` in this source directory. `node local/install.mjs` prepares a private user configuration, a repository-specific SSH publishing key, a local preview shortcut and the `chainwatch-collector.service` user unit. It does not enable the service itself or grant the key GitHub access.

Default state and configuration are under `~/.local/share/chainwatch/` and `~/.config/chainwatch/config.json`. These locations contain the database, progress cursors, caches, Git staging checkout and SSH key; none belongs in a public repository. The web preview binds only to `127.0.0.1:8794`.

Import public attribution records with:

```sh
node local/cli.mjs import /path/to/addresses.ndjson --config ~/.config/chainwatch/config.json
node local/cli.mjs import-results /path/to/previous-public-results.json --config ~/.config/chainwatch/config.json
node local/cli.mjs export --config ~/.config/chainwatch/config.json
systemctl --user daemon-reload
systemctl --user enable --now chainwatch-collector.service
```

Imports accept the existing public registry schema: `address`, `entity`, `label`, `category`, `source`, `source_url`, `confidence`, `last_updated`. JSON arrays and NDJSON are supported. The included seed has 1096 sourced addresses (including inferred cluster attributions); the extended catalog metadata describes 375,797 addresses across 412 attributed entities. Existing collector results can be retained with the separate public-results importer. Imported observations retain their last-verified timestamp and are rechecked as collection continues, and new local scan progress starts honestly at zero unless the actual jobs were migrated.

The service starts with your user session and resumes saved work after restarts. It keeps running without an open browser. It cannot process while the machine is off or asleep. If you need it to run after logout, user lingering must be enabled separately; this installer does not change that system setting.

## GitHub publishing

Create a dedicated public GitHub repository, normally `chainwatch`. Add the generated `github_publish_key.pub` in that repository’s **Settings → Deploy keys**, with write access. The private key stays on this computer and is restricted to that repository. GitHub host keys are pinned from GitHub’s HTTPS `/meta` endpoint.

Set these fields in the private configuration:

```json
{
  "publishRepo": "git@github.com:YOUR-ACCOUNT/chainwatch.git",
  "publishBranch": "main"
}
```

Restart the service. It publishes allowlisted application source under `source/` and the generated website under `docs/`. Set **Settings → Pages → Source → GitHub Actions**. The publisher includes a workflow that deploys only the public `docs/` folder after each update. The public address is `https://YOUR-ACCOUNT.github.io/chainwatch/`.

Publication uses normal fast-forward Git pushes, never force pushes. Each update starts from the current remote head and preserves unrelated paths. Only the reviewed `docs/`, `source/` and root README paths are staged; local configuration, databases, caches, SSH keys and GitHub tokens are excluded. The public site never calls the collector or the former cloud API. A dedicated publication checkout is marked and must be empty before first use.

The collector continuously processes bounded batches with paced requests and two requests in flight at most. It exports and attempts to publish every ten minutes by default. The dashboard checks for a new public snapshot every minute. The current and previous data generations remain available to prevent a reader from losing a snapshot during a deployment. A stale publication is labeled as such; the site remains readable while the computer is offline.

Manual commands:

```sh
node local/cli.mjs status --config ~/.config/chainwatch/config.json
node local/cli.mjs scan --config ~/.config/chainwatch/config.json
node local/cli.mjs export --config ~/.config/chainwatch/config.json
node local/run.mjs --config ~/.config/chainwatch/config.json
```

## Evidence and scope

The date window begins **September 1, 2026 UTC**. BTC and XBT share history through block 961631; divergence begins at 961632, before XBT’s BLAKE2b checkpoint at 961640.

Shared original outputs must match on both explorers. The result set contains divergent spends with six confirmations on both chains, standard opt-in protected XBT spends, and one-sided observations. One-sided observations are confirmed spends on one chain while the original output is reported unspent on the other; these do not prove replay protection. BTC spends with unspent XBT outputs are retained as one-sided observations; BTC-side replay protection is not required. Identical spends are discarded instead of stored as tracked transactions. One-sided observations are rechecked and removed if subsequently replayed. Canonical block checks and current output-spending lookups are retained when transaction bodies are cached. Missing explorer responses never mean unspent. Inscription signals alone do not establish protection. Results rely on explorer-reported inclusion, not independent proof-of-work and general script validation.

Observed splits are collapsed into one row per attributed institution, with that institution’s total input value and expandable transaction details. Expanded lists reveal 50 observations at a time, including matches beyond the former 200-row feed limit.

The dashboard labels which original coin stayed unspent: XBT stayed when BTC moved, or BTC stayed when XBT moved (including protected XBT spends). Both-spent pairs are labeled separately. Summary cards, institution summaries, transaction rows and evidence details show these outcomes as of the last check, without inferring intent.

The Confirmed split value card counts only divergent spends with six confirmations on both chains. The separate One-sided observed value includes all other matching observations. Values count watched original outputs once, including results beyond the visible feed and top ten. The alphabetized institution dropdown filters totals, rankings, observed transactions and the address directory alongside the text, category, evidence and date filters.

Rankings sum watched shared input value per BTC/XBT spending pair. They are not sales totals or claims of institutional intent. Ownership labels are public attributions and can be wrong or historical; inferred clusters are identified. Government custody is distinct from a strategic reserve. Backfill is incremental, and the top ten is only a ranking of verified results found so far.

The full catalog is stored on the machine and exported as immutable entity chunks plus address-prefix lookup shards. Browsing and institution/address search do not require downloading the complete address list. Result files are split into groups of 2,000 observations. Private diagnostics are excluded or sanitized by the export allowlist.

## Validation

`npm test` checks persistent state, result filtering, catalog paging and prefix searches, export privacy, safe Git publication, and collector proof rules. `npm run build` produces a standalone browser bundle under `pages-dist/`; copy it with an exported data snapshot for a local or GitHub Pages preview.

See `THIRD_PARTY_NOTICES.md` for address-label attribution and license notices. The signature and collector logic derives from the earlier Chainwatch implementation and the parent XBT experiment.

## Single-file manual upload

After building, run `node scripts/package-single.mjs ~/.local/share/chainwatch/site /path/to/index.html` to package the current public snapshot, dashboard, catalog and compact address index into one HTML file. Upload that file as `index.html` at the repository root and choose the root as the GitHub Pages source. It works without companion assets or a connection to the collector. The packager checks GitHub’s 25 MiB browser-upload ceiling.

This is a fixed data snapshot until a new file is uploaded. The collector keeps scanning locally; automatic publication still requires configuring the repository and its publishing access. The single-file page checks for an updated HTML version when hosted over HTTP, while it also remains usable offline.

Coinbase, Silk Road, El Salvador and Bitwise Bitcoin ETF (BITB) histories rotate in a priority queue ahead of the ordinary catalog. Newly added addresses in those institutions receive a first look before resuming long histories. Rotation keeps one priority institution from blocking the others. Completed histories retain the normal head-check rotation. The Coinbase supplement includes an [Arkham-attributed cold wallet](https://arkm.com/explorer/address/bc1qc5uavalcs93yw89x8xvh35vq3h003ujp4f74ap), marked as a cluster attribution rather than an official Coinbase disclosure.

Government additions include 19 more El Salvador addresses listed by the [official ONBTC wallet API](https://bitcoin.gob.sv/api/v1/wallet/ONBTC). Two court-documented Silk Road addresses are categorized as **Historical seizure** and explicitly do not establish current government control. They remain separate from Government and Government custody.

BITB wallets are imported from the issuer’s product-page `walletBalances` disclosure, including active and inactive addresses. Attribution is issuer-published, not inferred from transfer counterparties. The original lowercase `bitwise` record is normalized to Bitwise Bitcoin ETF (BITB); saved scan cursors remain intact.

## Replay assessment

After each successful discovery batch, one distinct BTC-only spending transaction
is assessed; all watched outputs spent by that transaction share the assessment.
Existing observations are included automatically, with BITB preferred among equally
old checks. Completed assessments are revisited hourly; transient/budget failures
retry after five minutes. Explorer cooldowns remain enforced. Discovery continues
independently and a failed replay check never implies an output is unspent.

If the local XBT 29.5 CLI is installed in its standard user directory, the checker
uses its local RPC cookie implicitly to run only `getblockchaininfo`,
`getblockhash`, and `testmempoolaccept`. The node must be synchronized on mainnet
and match the XBT checkpoint. `testmempoolaccept` is a validation dry run: no
transaction is broadcast. Optional `xbtValidationCli` and `xbtValidationDatadir`
settings override the local paths; these private settings are never exported.
Without an available node, the checker can inspect funding and conflicting spends,
but cannot call an otherwise compatible transaction replayable with certainty.

Assessment states distinguish node acceptance, node rejection, verified conflicting
inputs, missing funding transactions, pending conflicts, no input blocker found,
and incomplete or unavailable checks. Missing ancestors may themselves replay.
Node policy rejection, a fee threshold, or an inscription byte pattern alone does
not establish permanent replay protection. Output-size hints reference the local
XBT source thresholds (83 bytes OP_RETURN, 34 otherwise); active consensus rules,
input exemptions and script execution determine the actual result.

Public evidence exports include only assessment state, explanation and check time.
Raw transaction hex, RPC cookies, node paths and CLI error output are excluded.
The dashboard separates confirmed differing spends from one-sided coin value and
lets users filter replay assessments. The legacy snapshot-client field
`summary.totalSplitValue` retains the aggregate observed value for compatibility;
the displayed confirmed total uses `summary.confirmedSplitValue`.

Run a single queued check manually with `node local/cli.mjs replay --config
~/.config/chainwatch/config.json` when the collector is stopped. Local discovery
and replay workers share a process; do not run a second worker against a running
collector.
