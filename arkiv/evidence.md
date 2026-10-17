# On-chain evidence (Tiramisu)

Generated 2026-10-16T23:53:19.069Z. All data synthetic.

| Role | Address |
|---|---|
| admin | 0xF86D262905d8C54E19e24734959976f0d1108B32 |
| reporter | 0x5d3195C284c27e4e2fC045b5D9eB83959152a088 |
| reviewer | 0x91B3FD731E89Db067B758899408487E5c1C7ec60 |

| What | Entity key | Tx |
|---|---|---|
| reviewer allowlist entry | `0xeae40caa90bf245fc474fe964fa13aab05a1c1407115b14f327c27a5d1aee61b` | [0x76a876d0…](https://tiramisu.explorer.arkiv.network/tx/0x76a876d00c537db7b2a513927764a154da9b2e9e87dbd1e8a571d0c0a4c65b9c) |
| report (procurement) | `0x01063effe68b26b1bdf8615ba66051a76244261c335e80fc7f8d403c6814ee3b` | [0x2e1aafc1…](https://tiramisu.explorer.arkiv.network/tx/0x2e1aafc16f1adcc18da2f529be5e1b81bc5d5313a8ff03971462217df3aa3933) |
| report (public_safety) | `0xd76c66de7bf969931811398bb07d9e3cbe2c0097b961ca67679842250ace3d01` | [0xc35a2bcd…](https://tiramisu.explorer.arkiv.network/tx/0xc35a2bcd39afaa3654898e981d45c66daa97953bae4ae1ec076c18e74992381a) |
| report (environment) | `0x97c074fc77953c7cb4df27eaac79875b79ac08cfd044d73048f5fc7dc1904836` | [0x85f0ab41…](https://tiramisu.explorer.arkiv.network/tx/0x85f0ab4177fb01ee51a3ee186876b46659e883e7ceddde5a1aece7624888651b) |
| report (SEALED, encrypted) | `0x3f958b592db744b1b962243251b1d41cc81ada0358ffbed17faa6efb31e94505` | [0x4a81ef9f…](https://tiramisu.explorer.arkiv.network/tx/0x4a81ef9fd2a91d1551841b53cb70e9fc1c15153bdd232a5c5f03eefc62a05698) |
| report (LOCKED, owner = burn) | `0x637e0d483a36bc1bf8e00122c21cb7389c0bf666184c2c02e92039c8eac2116b` | [0x0a5359a1…](https://tiramisu.explorer.arkiv.network/tx/0x0a5359a12dde4b4551e5a48011bb2092b1f2931a5cc61ddae94145a16476ee06) |
| trusted review (allowlisted) | `0x5b18fe5b3f991610ed3fa891e0310f7b84b7b9854582e409f853d5b36fe76e2b` | [0xc71d543c…](https://tiramisu.explorer.arkiv.network/tx/0xc71d543c187e776e6cc23bbdfd4915fe9cae04405856ac4c62da9f01d1f559c5) |
| trusted review (allowlisted) | `0x8fc9186555cf81c5280dfe28908ddc826c09af8d29ddd5179edca275b73cc942` | [0xa424cfd7…](https://tiramisu.explorer.arkiv.network/tx/0xa424cfd7bbbeafbee70b3e683fdf770762c135637e1df0644c83f47998ec9bf9) |
| FORGED review (not allowlisted) | `0xdb5294b059dd2f9e427392f03b615f00beab8d3d0aa94e2ac157263c40cdaf38` | [0x1a3e6996…](https://tiramisu.explorer.arkiv.network/tx/0x1a3e699667fdde9e775b4881347007b4ab03677078338186e75c500f0076a6a7) |

Demo decryption key for the sealed report (synthetic): `AEnsEofJjSDh_4U3yQ_guYQSxnXWRMvwLaz-CL5oo0A`
Sealed report key: `0x3f958b592db744b1b962243251b1d41cc81ada0358ffbed17faa6efb31e94505`

## Second seed: second reviewer and a file fingerprint (synthetic)

| Role | Address |
|---|---|
| reviewer B | 0xA03798cDA2BC7fF3B0D1097E98d4E3ECcd429903 |

| What | Entity key | Tx |
|---|---|---|
| reviewer allowlist entry (B) | `0xc94bf464932723c6ed2d97c2518f7253e420985477426b2ed9ff35757d53061d` | [0xeb6541c4…](https://tiramisu.explorer.arkiv.network/tx/0xeb6541c404023904cec9430834aebb5c322a22ec2cc498b6617dfe55a3ec73e4) |
| trusted review B: corroborated (procurement) → Verified | `0x095dfd17e000c486a474a7589967b55ec6660918fe8e87eb1ee2c004fc9d6191` | [0x304c91fb…](https://tiramisu.explorer.arkiv.network/tx/0x304c91fbbe5c865803fd4226d6366498d7b164a523cc63a563574f9b4743567d) |
| trusted review B: disputed (public_safety) → Disputed | `0x27b771c9127af51ddd8f80151dc5da721b90cb1bc0a688d9a0b19fbf3c12d025` | [0xaa1b4f2b…](https://tiramisu.explorer.arkiv.network/tx/0xaa1b4f2bd3cebdc721e78e9ee1dcc9349be2a49c0b0389f08b2f808379f7c300) |
| report with media fingerprint (sha256 0xbe11757b…) | `0xc203a360f913f888b437d072c2e12eeb2b6ec843795617c5640ce2cfcf597ea3` | [0x9b737068…](https://tiramisu.explorer.arkiv.network/tx/0x9b737068c4086129ed9f60d38825c683130fd2e984e6224dbb6b05d0cc8c43fa) |
| trusted review A: corroborated (media) → In review | `0x3acf7f6963f556a6e751182a132000473a06de883278cdae57d8402083665e95` | [0x73ac2c88…](https://tiramisu.explorer.arkiv.network/tx/0x73ac2c88b9fd8ec3223a1a23130e47e9049df65a51d1443d0ba08ced3649c618) |

Sample files on the site: /demo/synthetic-image.png (matches the media report) and /demo/synthetic-image-tampered.png (one pixel changed, does not match).

## Third seed: images linked from another host (synthetic)

| What | Entity key | Tx |
|---|---|---|
| Synthetic: image hosted elsewhere (fingerprint matches) | `0xe7dc8e178aca6ba554c36c881441dfd011f3a2af6ae6875c0efb16887fdc9255` | [0x960fb086…](https://tiramisu.explorer.arkiv.network/tx/0x960fb086544807eff942597099c480edb688a906449b03817a23633312201071) |
| Synthetic: link points to a different file (must be refused) | `0xbb7d9139bc26e4fe07b170278a7248627e2aa94a206df3813a0ad3b483d5fb05` | [0xa3fc0e77…](https://tiramisu.explorer.arkiv.network/tx/0xa3fc0e77dfb087648570fa625888024d7926d13ca0cb708b9a34c1d01f7fad90) |

## Fourth seed: reports with an embedded preview image (synthetic)

| What | Entity key | Tx |
|---|---|---|
| Synthetic: report with a picture (verified) | `0x9283d92f22b0ec99dfbaf4624c40625efb289794e37803c8bbc0e1d3de5a7f23` | [0x4fb750e2…](https://tiramisu.explorer.arkiv.network/tx/0x4fb750e23bb20f026fb9c4a974fa14372dc8a765366e19165187c30637352893) |
| review: corroborated → Verified | `0x52ff14cb3b48063aaf13fd59800ed9d7678596aa7e35272bb5159924009f2802` | [0x7050736d…](https://tiramisu.explorer.arkiv.network/tx/0x7050736df4b461126b11e30e68d8dd29c10ddcecb4d728841b9c2ce5fbbaff71) |
| review: corroborated → Verified | `0x799b848eba5c98e1147e6f69b3a069641a0b3308b0268fdb8e8ec9bfe31729ae` | [0x18f07c71…](https://tiramisu.explorer.arkiv.network/tx/0x18f07c712056093633db61e18f2435417bedae8bde9f6a4f5a6640a83e02fe51) |
| Synthetic: report with a picture (not reviewed) | `0x124b91302a799151b82358dc595237098059db264e7e5da4bb383a37f0b0a2d4` | [0x236a0071…](https://tiramisu.explorer.arkiv.network/tx/0x236a0071b6ce1550ce35e51dde6a4a9cfd072846dd10934917751f78ba06eb50) |
