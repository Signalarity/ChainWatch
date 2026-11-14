# Chainwatch: local computation, public GitHub Pages results

The collector runs on the publisher’s computer. A public GitHub Pages dashboard reads the last published snapshot. The computer needs outbound internet access only; no node RPC or inbound router port is exposed. Visitors cannot initiate scans, add addresses, or access the local database.

## Evidence and scope

The date window begins **September 1, 2026 UTC**. BTC and XBT share history through block 961631; divergence begins at 961632, before XBT’s BLAKE2b checkpoint at 961640.

Shared original outputs must match on both explorers. The result set contains only splits: divergent spends with six confirmations on both chains, standard opt-in protected XBT spends, and confirmed spends on one chain while the original output remains unspent on the other. BTC spends with unspent XBT outputs are counted as observed splits; BTC-side replay protection is not required. Identical spends are discarded instead of stored as tracked transactions. One-sided observations are rechecked and removed if subsequently replayed. Canonical block checks and current output-spending lookups are retained when transaction bodies are cached. Missing explorer responses never mean unspent. Inscription signals alone do not establish protection. Results rely on explorer-reported inclusion, not independent proof-of-work and general script validation.

Observed splits are collapsed into one row per attributed institution, with that institution’s total input value and expandable transaction details. Expanded lists reveal 50 observations at a time, including matches beyond the former 200-row feed limit.

The Total coins split card sums every matched original output value once, including results beyond the visible feed and top ten. The alphabetized institution dropdown filters totals, rankings, observed transactions and the address directory alongside the text, category, evidence and date filters.

Rankings sum watched shared input value per BTC/XBT spending pair. They are not sales totals or claims of institutional intent. Ownership labels are public attributions and can be wrong or historical; inferred clusters are identified. Government custody is distinct from a strategic reserve. Backfill is incremental, and the top ten is only a ranking of verified results found so far.

The full catalog is stored on the machine and exported as immutable entity chunks plus address-prefix lookup shards. Browsing and institution/address search do not require downloading the complete address list. Result files are split into groups of 2,000 observations. Private diagnostics are excluded or sanitized by the export allowlist.
