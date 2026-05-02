# AEGIS402 Insured Escrow Hook MVP

This repository contains a Hardhat MVP for an insured escrow Uniswap v4 hook.

The E2E scenarios run on a local Hardhat chain forked from Sepolia and use the official Sepolia Uniswap v4 test deployments:

- PoolManager: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`
- PoolSwapTest: `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`
- PoolModifyLiquidityTest: `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a`

## Setup

```bash
nvm use
npm install
npm run compile
```

The default Sepolia fork RPC is `https://sepolia.gateway.tenderly.co`. To override it, create `.env`:

```bash
SEPOLIA_RPC_URL=https://your-sepolia-rpc.example
```

## E2E Design

The E2E scripts deploy fresh mock ERC20 tokens, a Uniswap v4 pool, the AEGIS hook, vault, insurance pool, and protected swap adapter on the local Sepolia fork.

The hook is deployed with CREATE2 so its address has the Uniswap v4 permission bits for:

```text
AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG
```

Protected swaps pass non-empty `hookData`. The hook takes the output token from PoolManager into `EscrowVault` and records the trade as `Pending`. The authorized auditor then chooses one of two outcomes:

- clean audit: `release(tradeId)` sends escrowed output to the settlement recipient;
- failed audit: `payClaim(tradeId, "SANDWICH")` blocks settlement, pays the user from `InsurancePool`, and recovers escrowed output into the insurance pool.

## E2E Commands

Run the normal clean-audit scenario:

```bash
npm run e2e:normal
```

Run the sandwich-shaped failed-audit scenario:

```bash
npm run e2e:sandwich
```

Run both:

```bash
npm run e2e
```

Run the full fork test suite:

```bash
npm run test:fork
```

## Case 1: Normal Clean Audit

Script: `scripts/e2e/normal.js`

Input:

| Field | Value |
| --- | --- |
| Scenario | `normal-clean-audit-release` |
| User input | `100.0` input token |
| Expected output | `99.0` output token |
| Protection fee | `0.35` input token |
| Auditor action | `release(tradeId)` |

Observed output from the local Sepolia fork run:

| Field | Value |
| --- | --- |
| Pending escrow state | `1` (`Pending`) |
| Escrowed output | `99.69006090092817746` output token |
| Recipient before release | `0.0` output token |
| Recipient after release | `99.69006090092817746` output token |
| Vault after release | `0.0` output token |
| Insurance input reserve before | `100000.0` input token |
| Insurance input reserve after | `100000.35` input token |
| Final escrow state | `2` (`Released`) |

Conclusion:

```text
PASS: protected output was escrowed first, then released to the settlement recipient by auditor action.
```

## Case 2: Sandwich-Shaped Failed Audit

Script: `scripts/e2e/sandwich.js`

Input:

| Field | Value |
| --- | --- |
| Scenario | `sandwich-shaped-audit-failure-claim` |
| Victim input | `100.0` input token |
| Attacker front-run input | `10000.0` input token |
| Attacker back-run input | `9871.580343970612988504` output token |
| Auditor action | `payClaim(tradeId, "SANDWICH")` |

Observed output from the local Sepolia fork run:

| Field | Value |
| --- | --- |
| Baseline victim output | `99.69006090092817746` output token |
| Attacked victim output | `97.731674794032659216` output token |
| Output shortfall vs baseline | `1.958386106895518244` output token |
| Pending escrow state | `1` (`Pending`) |
| Final escrow state | `3` (`ClaimPaid`) |
| User input before claim | `9899.65` input token |
| User input after claim | `9999.65` input token |
| Recipient after claim | `0.0` output token |
| Insurance input reserve before claim | `100000.35` input token |
| Insurance input reserve after claim | `99900.35` input token |
| Insurance recovered output before claim | `0.0` output token |
| Insurance recovered output after claim | `97.731674794032659216` output token |
| Vault after claim | `0.0` output token |

Conclusion:

```text
PASS: suspicious settlement was blocked, user received the original input amount, and escrowed output was recovered by the insurance pool.
```

## Notes

- The printed mock token addresses can change if deployment order changes.
- The output amounts are from a deterministic local fork run using the current scripts and pool setup.
- A production system should replace the single auditor EOA with multisig, role-based access, or another governed attestation path.
