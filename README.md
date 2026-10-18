# WitNess

A public registry for documentation that no single server can switch off or quietly rewrite.
Built for the **Arkiv: Global Tour Stop** (Censorship Resistance track), on the Arkiv **Tiramisu** testnet.

> **The demo reports are either synthetic test data, or short sample news summaries.** The news summaries are written for this demo in our own words, name no private individuals, use no photos from news sites, and each links to its original source. Nothing is verified unless it says Verified.
> Everything on Arkiv is public, so please do not post real incidents or personal data to this demo.

**Live demo:** https://witness.ibnweb3lab.workers.dev · **Code:** https://github.com/ibnweb3/witness

## Why this exists

In October 2020, young Nigerians filmed and streamed what was happening at the Lekki Toll Gate during the
#EndSARS protests. Afterward, what happened there was disputed, and the evidence sat on platforms and servers
other people controlled. In June 2021, Twitter was suspended nationwide in Nigeria for about seven months.
In Gaza, restricted press access and repeated communications blackouts leave documentation scattered and contested.

Different places, same gap: a record is only as safe as the server that holds it.
WitNess is a small, honest answer to one part of that gap.

## What it does

- **Reports are frozen.** A report is created with the `readonly` flag, so its content and attributes cannot be edited afterward.
- **Anyone can keep a report alive.** Reports are created with `permissionlessExtension`, so any wallet can extend a report's life. The author does not have to be around.
- **Optional lock.** The author can move ownership to a burn address in the same atomic batch, so nobody, including the author, can delete it. This cannot be undone.
- **Optional encryption.** A report can be encrypted in the browser (AES-GCM). The key lives only in the share link's URL fragment and is never sent to any server.
- **Reviews count only from allowlisted wallets.** The app shows a review as trusted only when its immutable on-chain `$creator` is on an allowlist published by an admin wallet. A forged review from any other wallet is shown as ignored, with the reason.
- **Verified only by a council, never by the author.** A report starts as Unverified. It shows as Verified only when at least 2 different allowlisted reviewers corroborate it and none dispute it. Each reviewer's latest verdict stands. The rule is applied by the app when it reads public entities (Arkiv has no smart contracts, so the chain does not enforce it), and anyone can recompute it.
- **Photo and video fingerprints, and optional previews.** A report can carry the SHA-256 fingerprint of a photo or video. The original file is never uploaded to Arkiv or to this site. On the report page, anyone can drop a copy they were given and the browser checks whether it is byte-for-byte the recorded file. Sample files to try: `/demo/synthetic-image.png` and `/demo/synthetic-video.webm` (match), and `/demo/synthetic-image-tampered.png` (one pixel changed, does not match). If the author also gave an https link, readers can choose to load it from that host: an image is shown, and a video (MP4 or WebM) is played, but only after a click (the host sees their IP), and where the host allows it the browser checks the download against the fingerprint (images always; videos up to 25 MB) and refuses a different file. An author can also store a small preview picture: for an image the browser shrinks it to about 60 KB and drops its location data; for a video it takes one still frame in the browser. That picture is stored inside the report's payload (the Arkiv team confirmed this is allowed); the video itself never is. **A picture is sharp on a homepage card only after the report is Verified.** On an unverified report it is shown blurred, with a label, and the reader clicks to reveal it on the report page; a disputed report's picture is not shown unless the reader asks, and carries a warning.
- **Wallet profiles.** There are no accounts or passwords: your wallet address is your identity. A profile page lists everything a wallet created, read with a `$creator` filter. Connecting a wallet shares only the public address and signs nothing.
- **A homepage news slideshow.** The big card cycles through the newest sample news items (autoplay every six seconds, with previous and next, dots and a Pause button; it pauses on hover, when off-screen, and does not autoplay for visitors who prefer reduced motion). A switch next to the filters lets a viewer turn the blur on unverified pictures off; it is on by default.
- **Reads need none of our servers.** The site is static. Your browser queries the public Arkiv RPC directly. The Proof page runs the exact query and lets you point it at a different RPC.

## What it does not do

- It does **not** make anyone anonymous. The posting wallet is public, and a funding transaction can link wallets.
- It does **not** prove a report is true. It makes a record harder to erase or rewrite, and shows who vouched.
- A matching file fingerprint proves a photo or video is unchanged since it was recorded. It does **not** prove the content is genuine, and it cannot detect a forgery that was recorded as-is. We do not use AI "deepfake detectors"; they are unreliable.
- The reviewer allowlist is published by one admin wallet, so reviewer selection is not decentralized yet. Letting reviewers vote new reviewers in is roadmap, not built. There is no token and no on-chain DAO.
- A government could block the public RPC address. The data lives on the network and can be read through any RPC, but the RPC has to be reachable.
- Writing needs internet too. In a blackout nobody can post.
- Reports expire unless extended. An expired report leaves the query surface, but its creation transaction stays on-chain.
- Reads need an Arkiv RPC with enough query budget. The anonymous public RPC has a small cost-based budget (error `ANON_COST_LIMITED`, hourly windows) that, in my testing, was usually empty. So this site uses an Arkiv access key as its main RPC, restricted to the site's origin, and falls back to the anonymous RPC. **The key is built into the page and visible in its network requests**, because a static site has nowhere to hide it; Arkiv's docs advise keeping keys on a backend. The worst case is someone spending the testnet quota, after which the site falls back to the anonymous RPC and may show a rate-limit message. The app also caches reads for 30 to 45 seconds. See `arkiv/friction.md` (F3, F4, F5). Anyone can run the same queries against any RPC from the Proof page.
- Arkiv documents a keccak Merkle-Patricia state root readable with `eth_getProof`. This UI does not verify proofs itself.

## How it uses Arkiv

Full detail: [`arkiv/schema.md`](arkiv/schema.md). Friction report: [`arkiv/friction.md`](arkiv/friction.md). On-chain evidence: [`arkiv/evidence.md`](arkiv/evidence.md).

| Arkiv feature | Where | Why it changes what the user sees |
|---|---|---|
| `$creator` filtering (`eq('$creator', addr(...))`) | [`src/lib/arkiv.ts`](src/lib/arkiv.ts) `listTrustedReviews` | A review counts only if its creator is allowlisted; nobody can fake `$creator`. |
| `createdBy()` | `listAllowlist` | The allowlist is read only from entities the admin wallet created. |
| `readonly` + `permissionlessExtension` flags | [`src/lib/write.ts`](src/lib/write.ts) `createReport` | Frozen content; the community can keep it alive. |
| `executeBatch` + `predictEntityKeys` + `changeOwnership` | `createReport` (lock) | Create and lock in one atomic transaction. |
| Per-type Entity Expiration | `config.ts`, `write.ts` | Report 30 d, review 90 d, reviewer 180 d. A review outlives its report on purpose. |
| Lifetime Extension (`extendEntity`) | `extendReport`, report page button | A report is a lease anyone can renew. |
| Typed attributes and range queries | `listReports` | `incident_ms` is a `u64`, so the feed filters by date range on the node. |
| `createdBy()` on reports | `listReportsBy` | A wallet profile is one `$creator` filter. |
| Cursor pagination | `listReports` (async iteration) | Walks all pages, sorted client-side by posting time (newest first). |
| `$expiresAt` range query | `expiringSoon` | Find reports that expire within a day. |
| WebSocket entity events, no `fromBlock` | `watchFeed` | New and extended reports appear live without a refresh loop. |

What stays **off** Arkiv on purpose: decryption keys, full-size photo and video files (only a SHA-256 fingerprint is recorded, plus an optional small preview), reviewer real identities, and any real personal data.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev          # the site, reads straight from Tiramisu
```

To write data you need test GLM. The faucet at https://hub.arkiv.network/faucet requires a wallet sign-in.

```bash
# .env (never commit it): ADMIN_KEY, REPORTER_KEY, REVIEWER_KEY (and REVIEWER2_KEY for `npm run seed2`) are funded Tiramisu test keys.
# Optional: ARKIV_RPC_URL=<RPC URL with an Arkiv access key> for scripts, and VITE_ARKIV_RPC=<same> in .env.local for the site build.
npm run balances     # check funding
npm run seed         # creates a synthetic reviewer, reports, reviews and one forged review; writes arkiv/evidence.md
npm run build        # static site in dist/
```

Posting from the site uses a browser wallet (for example MetaMask), which it switches to Tiramisu (chain ID 7738577).

## How judges can reproduce the Arkiv usage

1. Open the live site. No login is needed.
2. Open **Proof** and press **Run this query from my browser**. It runs `project = str('witness-reg-ibn26') AND entity_type = str('report')` against the public RPC and prints the matching report keys.
3. Open a report that has reviews. The page lists trusted reviews, and any review from a non-allowlisted creator under "ignored", with the reason.
4. Compare the wallet addresses in [`arkiv/evidence.md`](arkiv/evidence.md) with the creators shown on the explorer: https://tiramisu.explorer.arkiv.network
5. Open the report titled "Synthetic: sample photo with a fingerprint", download `/demo/synthetic-image.png`, and use **Check a file** to see a match. Then try `/demo/synthetic-image-tampered.png` to see the mismatch.
6. Open "Synthetic: inflated contract notice" to see a **Verified** status (two reviewers), and "Synthetic: road closure log" for **Disputed**.
7. Open any report tagged "News" (for example the WHO or UN News items): its page has a **Source** card linking to the publisher. Those items are Unverified.
8. Optional, needs a wallet with test GLM: press **Keep this alive** on any report, or post a new one.

## Project layout

```
src/lib/arkiv.ts    queries and live events (read side)
src/lib/write.ts    create report / review / reviewer, extend (write side)
src/lib/crypto.ts   browser AES-GCM sealing and SHA-256
src/lib/wallet.ts   injected wallet connection, switches to Tiramisu
src/main.ts         pages: feed, report, post, proof
scripts/seed*.ts    synthetic data, and seed-news.ts + news.json for the sample news items; all write arkiv/evidence.md
arkiv/              schema.md, friction.md, evidence.md
```

## Disclosure

- Built between 9 and 18 October 2026. Pre-existing work reused: none (libraries only: `@arkiv-network/sdk`, `viem`, `vite`).
- AI assistance: built with Claude (Anthropic) in Claude Code.
- The homepage banner illustration (`public/img/witness-banner.webp`) was generated with Grok (xAI) from our own prompt: a silhouetted figure raising a hand at a witness stand. It shows no real person.

## Photo credit

The photograph on the About page, `public/img/endsars-lagos.jpg`, is "Protesters at the endSARS protest in Lagos, Nigeria 71" by Kaizenify, licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), via
[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Protesters_at_the_endSARS_protest_in_Lagos,_Nigeria_71.jpg).
It is shown unmodified, as background only. It is not evidence of any event described in this project. The MIT licence below covers the code, not this photo.


## Picture credits for the sample news items

Each of the 30 sample news reports carries a small picture from Wikimedia Commons, resized and compressed (and stripped of metadata) to fit the 128 KiB payload limit. None is a publisher's photo. Credits (also shown on each report page):

- WHO publishes its first global guidelines on obesity in children and adolescents: "Fresh vegetables,fresh fruits and Gnuts" by Kalungi Nathan, CC BY-SA 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fresh_vegetables,fresh_fruits_and_Gnuts.jpg)
- New global roadmap targets high blood pressure in pregnancy: "Sphygmomanometer&Cuff" by ML5 at English Wikipedia, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Sphygmomanometer%26Cuff.JPG)
- WHO urges countries to move from long-stay psychiatric hospitals to community care: "Path through The Green Community Garden, Penrhys - geograph.org.uk - 4428579" by Jaggery, CC BY-SA 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Path_through_The_Green_Community_Garden,_Penrhys_-_geograph.org.uk_-_4428579.jpg)
- UN chief warns biodiversity protection is off track ahead of COP17: "GRNMS - Painted wrasse and sargassum (27626284033)" by National Marine Sanctuaries, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:GRNMS_-_Painted_wrasse_and_sargassum_(27626284033).jpg)
- UN ocean assessment: sea-level rise has doubled and over a third of fish stocks are overfished: "Leigh-on-Sea beach sunset (Unsplash)" by Joshua Fuller joshuafuller, CC0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Leigh-on-Sea_beach_sunset_(Unsplash).jpg)
- Press freedom group: four more journalists detained in Turkey under the disinformation law: "Newspaper Cones 2009 (3890107375)" by ElCapitanBSC, CC BY-SA 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Newspaper_Cones_2009_(3890107375).jpg)
- UN agency warns internet shutdowns are rising worldwide: "Cable closet bh" by Unknown, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Cable_closet_bh.jpg)
- UK reports on its open contracting reforms a year after the Procurement Act: "Palacio de Westminster, Londres, Inglaterra, 2014-08-07, DD 027" by Diego Delso, CC BY-SA 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Palacio_de_Westminster,_Londres,_Inglaterra,_2014-08-07,_DD_027.JPG)
- Analysis: UK direct contract awards fell, but few contracts report performance data: "Legal Contract & Signature - Warm Tones" by Blogtrepreneur, CC BY 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Legal_Contract_%26_Signature_-_Warm_Tones.jpg)
- Security researchers: npm attacks are growing and moving into build pipelines: "Padlock klódka ubt" by Tomasz Sienicki, CC BY-SA 3.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Padlock_kl%C3%B3dka_ubt.JPG)
- Analysis: Europe's green procurement ambition has a measurement problem: "Car2Go Charging Station Stuttgart 2013 01" by Julian Herzog (Website), CC BY 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Car2Go_Charging_Station_Stuttgart_2013_01.jpg)
- Open Contracting Partnership: transparency and data should drive EU procurement reform: "European Union flags in Finland" by futureatlas.com, CC BY 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:European_Union_flags_in_Finland.jpg)
- OCP on the EU's draft Public Procurement Act: a digital backbone: "Berlaymont building of European Commission in cloudy weather" by MPorciusCato, CC BY-SA 3.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Berlaymont_building_of_European_Commission_in_cloudy_weather.jpg)
- Open Contracting Partnership: AI won't fix procurement corruption, but may help catch it: "Magnifying glass" by Tomomarusan, CC BY 2.5, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Magnifying_glass.jpg)
- Wiz: npm packages under a Red Hat namespace compromised in the 'Miasma' attack: "100DaysOfCode (Unsplash)" by Lewis Ngugi ngeshlew, CC0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:100DaysOfCode_(Unsplash).jpg)
- Socket: a wave of npm attacks hit the @antv ecosystem: "Volutz cable" by Fæ, CC BY 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Volutz_cable.jpg)
- UN rights chief: the clock on AI regulation is ticking: "Microchip PIC 16HV615" by Bengt-re, CC BY 3.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Microchip_PIC_16HV615.jpg)
- UN report warns that neural data needs stronger protection: "Human Brain, with its basis upward. Wellcome L0001409" by Wellcome Collection, CC BY 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Human_Brain,_with_its_basis_upward._Wellcome_L0001409.jpg)
- UN rights office: attacks on media workers must end: "Microphone Neumann U-47 (1949)" by Goldfinger (original uploader, Serbian Wikipedia), CC BY-SA 3.0 rs, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Microphone_Neumann_U-47_(1949).jpg)
- Sudanese Journalists Syndicate wins UNESCO press freedom prize: "Pair of Vintage Philmore Junior Microphones, Attach to Your Radio, Philmore Mfg. Co., Inc., Richmond Hill 18, N.Y. (9758728351)" by Joe Haupt from USA, CC BY-SA 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Pair_of_Vintage_Philmore_Junior_Microphones,_Attach_to_Your_Radio,_Philmore_Mfg._Co.,_Inc.,_Richmond_Hill_18,_N.Y._(9758728351).jpg)
- WHO releases guidance to prevent heat illness at mass gatherings: "Raumthermometer Fahrenheit+Celsius" by Stilfehler, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Raumthermometer_Fahrenheit%2BCelsius.jpg)
- Chile becomes the first South American country validated for eliminating dog-transmitted rabies: "How could you be mad at a face like this? (5692287896)" by Zach Dischner, CC BY 2.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:How_could_you_be_mad_at_a_face_like_this%3F_(5692287896).jpg)
- WHO announces flu vaccine recommendations for the 2027 southern hemisphere season: "Vero Cell COVID-19 vaccine vial, cotton swab and syringe" by Ajay Kumar Chaurasiya, CC BY-SA 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Vero_Cell_COVID-19_vaccine_vial,_cotton_swab_and_syringe.jpg)
- UNICEF: over 347 million children could face extreme dry or wet weather from El Nino: "Polygonal cracks in drought-dried soil near La Guardia, Margarita Island, Venezuela" by Wilfredor, CC0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Polygonal_cracks_in_drought-dried_soil_near_La_Guardia,_Margarita_Island,_Venezuela.jpg)
- UN Environment Programme: rotting food causes up to 10 percent of global emissions: "Unharvested apples fallen and rotting where they lie - fallen fruit - food waste - Golden Dorset" by Jengod, CC BY-SA 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Unharvested_apples_fallen_and_rotting_where_they_lie_-_fallen_fruit_-_food_waste_-_Golden_Dorset.jpg)
- UNESCO: press freedom has declined 10 percent worldwide: "Double Octuple Newspaper Press" by Sue Clark, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Double_Octuple_Newspaper_Press.jpg)
- ILO: Nepal floods threaten jobs well beyond the disaster zone: "Flood under the Old Route 49 bridge crossing over the South Yuba River in Nevada City, California" by Kelly M. Grow/ California Department of Water Resources, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Flood_under_the_Old_Route_49_bridge_crossing_over_the_South_Yuba_River_in_Nevada_City,_California.jpg)
- WHO: cholera deaths in 2025 were the highest reported since 1999: "Agar plates different types" by Lilly_M, CC BY-SA 3.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Agar_plates_different_types.jpg)
- UN deputy chief: overshooting 1.5 degrees is not a reason to give up: "NASA-funded study says glacier shape matters and influences vulnerability to melting (33287611943)" by NASA Goddard Space Flight Center from Greenbelt, MD, USA, Public domain, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:NASA-funded_study_says_glacier_shape_matters_and_influences_vulnerability_to_melting_(33287611943).jpg)
- UN report: fewer than half of national biodiversity targets are on track: "Dülmen, Börnste, Waldweg -- 2015 -- 4649" by Dietmar Rabich, CC BY-SA 4.0, [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:D%C3%BClmen,_B%C3%B6rnste,_Waldweg_--_2015_--_4649.jpg)

Adapted copies (resized and compressed) of the CC BY-SA pictures stay under their original licence; this repository's MIT licence covers the code only.

## License

MIT (code). See [LICENSE](LICENSE). The photo above keeps its own licence.
