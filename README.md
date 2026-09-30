<h1 align="center">
  <img src="https://github.com/user-attachments/assets/0cc687fb-89c4-43fa-a056-d89c307215ad" alt="Kuest" height="96" /><br/>
  Kuest — Open-Source Prediction Market
</h1>

<p align="center">
  White-label prediction market infrastructure built on Polygon.<br/>
  Deploy it, brand it, and earn trading fees — in under 15 minutes.
</p>

<p align="center">
  <a href="https://kuest.com">kuest.com</a> ·
  <a href="https://demo.kuest.com">Live Demo</a> ·
  <a href="https://docs.kuest.com">Owner Docs</a> ·
  <a href="#launch">Launch</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <a href="https://github.com/kuest/prediction-market">
    <a href="https://discord.gg/kuest"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&style=social" /></a>
    &nbsp;
    <img src="https://img.shields.io/github/stars/kuest/prediction-market?style=social" alt="GitHub Stars" />
  </a>
</p>

---

## Why this exists

Prediction markets are processing **$18B+ in monthly trading volume** — and 66% of that demand comes from outside the US, without a single local operator to capture it.

Kalshi (CFTC-regulated, 200x annual volume growth) just signed its **first international brokerage deal** with XP Inc. — Brazil's largest investment platform with 4.7M clients. Their co-founder put it plainly:

> _"It makes sense for us to go through these international partners. They already have the customers and the brand."_
> — Luana Lopes Lara, co-founder & COO, Kalshi · [Bloomberg, March 2026](https://www.bloomberg.com/news/articles/2026-03-09/kalshi-teams-up-with-brazil-s-xp-for-first-international-push)

Kalshi can do that one deal at a time. Kuest makes the same capability available to any operator — without a bilateral negotiation.

**Kuest is the infrastructure layer.** You bring the brand and audience. We handle the rest.

---

## What you get

- **Your own branded prediction market** — custom domain, logo, categories, fee rate
- **Shared liquidity from day one** — mirrored Polymarket markets with live order flow
- **Trading fees go directly to you** — no revenue share, no intermediary
- **Full Web3 stack, zero backend work** — Polygon, USDC, UMA resolution (soon), Vercel deploy
- **Bot-ready APIs and SDKs** — Python / Rust, compatible with existing Polymarket tooling
- **Multi-language UI** — built-in i18n, theme customization, mobile-ready

---

## Stack

<p align="center">
  <img src="https://github.com/user-attachments/assets/364a3525-7102-4a20-b096-12eb5337a62b" height="28" alt="Next.js" />
  <img src="https://github.com/user-attachments/assets/88cc61ff-e068-46a4-b197-0c7b7d421bb3" height="28" alt="TypeScript" />
  <img src="https://github.com/user-attachments/assets/dd1c533d-001f-4732-87d9-2b76f4280b58" height="28" alt="Polygon" />
  <img src="https://github.com/user-attachments/assets/a403c566-08cc-4bfc-82f2-d1e2e77d1809" height="28" alt="USDC" />
  <img src="https://github.com/user-attachments/assets/9bed7d91-57ba-4652-90d4-e7c83873b24b" height="28" alt="Safe" />
  <img src="https://github.com/user-attachments/assets/23dbcdb4-ce31-40b9-a1c5-bedd3ce55a6c" height="28" alt="Reown" />
  <img src="https://github.com/user-attachments/assets/080146ee-00bd-4e5d-8b24-b84ae6321fa3" height="28" alt="Li.Fi" />
  <img src="https://github.com/user-attachments/assets/5f2935d3-ee8d-43d3-8362-873003e92f03" height="28" alt="wagmi/viem" />
</p>

> **Why Polygon + Polymarket-derived contracts?**
> Most prediction market liquidity already lives here. Existing bots, market makers, and USDC balances are already in this environment. Smart contracts are derived from Polymarket's audited CLOB architecture and adapted to support shared liquidity across multiple operator frontends.

---

## Launch

|     | Option                                                                                                                                     | Best for              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| ⚡  | **[No-code Launch](https://kuest.com/launch)** - fill out the guided setup and go live fast                                                | Most operators        |
| 🔧  | **[Vercel + Supabase](https://docs.kuest.com/manual-installation/vercel)** - hosted deployment with full codebase control                  | Technical operators   |
| 🏗️  | **[Manual installation](https://docs.kuest.com/manual-installation/overview)** - Docker, VPS, Cloud Run, Fly.io, Kubernetes, and Terraform | Advanced / enterprise |

---

## Who is this for

| Operator type                         | Why prediction markets                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Brokerages & investment platforms** | Add a new asset class for clients — event contracts on rates, elections, macro indicators. XP just did this with Kalshi. You can do it without the bilateral deal. |
| **Financial media & news groups**     | Turn your audience's market conviction into a tradeable product. Embed live markets. Earn fees instead of running ads.                                             |
| **Fintech & neobrokers**              | Differentiate with an instrument your competitors don't offer. First mover in your market.                                                                         |
| **Crypto projects & DAOs**            | Launch community prediction markets with on-chain fee distribution and shared liquidity.                                                                           |
| **Creators & communities**            | Sports, politics, entertainment — any niche with a passionate audience.                                                                                            |

---

## Roadmap

**Completed**

- [x] Polymarket-compatible UI and market pages
- [x] Polygon mainnet support
- [x] Shared liquidity across operator sites
- [x] Configurable fees per operator
- [x] On-chain affiliate / trustless fee sharing
- [x] CLOB engine + relayer
- [x] Matching engine
- [x] Deposit Wallet trading flows
- [x] Public bot SDK (Python / Rust)
- [x] PnL system + trader leaderboard
- [x] Multi-language UI + theme customization
- [x] Crypto, Nasdaq, sports, and community markets
- [x] Operator-created markets with opt-in network sharing
- [x] Gamma metadata API (site-isolated)
- [x] Country Access Restrictions
- [x] Outcome and Polymarket arbitrage trading features
- [x] Sumsub identity verification (KYC) integration

**In progress**

- [ ] 🏆 MVP — stress tests, security, and financial consistency checks
- [ ] Move matching engine to mainnet
- [ ] Kalshi market mirroring + arbitrage connector
- [ ] MOOV2 integration with onchain Proposer Whitelist

---

## Follow

<p>
  <a href="https://x.com/kuest"><img alt="X" src="https://img.shields.io/badge/X-@kuest-000?logo=x&style=social" /></a>
  &nbsp;
  <a href="https://discord.gg/kuest"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&style=social" /></a>
  &nbsp;
  <a href="https://kuest.com"><img alt="Website" src="https://img.shields.io/badge/Website-kuest.com-111?style=social" /></a>
  &nbsp;
  <a href="mailto:hello@kuest.com"><img alt="Email" src="https://img.shields.io/badge/Email-hello%40kuest.com-444?logo=gmail&style=social" /></a>
</p>

---

**License:** [Kuest MIT+Commons](LICENSE). Custom branding, frontend changes, and custom UX are welcome. Production deployments must use Kuest infrastructure. Running an independent trading stack or white-glove institutional deployment requires a [commercial agreement](mailto:hello@kuest.com).
