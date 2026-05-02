# AEGIS402 Insured Escrow Uniswap v4 Hook

## 1. Project Summary

**AEGIS402 Insured Escrow Uniswap v4 Hook** is a payment-protection layer for Uniswap v4 swaps.

When a user performs a protected swap, the swap output is not immediately delivered to the final recipient. Instead, the output is held in an escrow vault. After the trade, an auditor decides whether the trade looks clean or whether it should be treated as a sandwich/MEV-impacted execution.

If the trade is clean, the escrowed output is released to the intended settlement recipient. If the trade is suspicious, settlement is blocked and the user is paid back the same amount of input token from the insurance pool. The escrowed output is recovered into the insurance pool.

The product is not a swap rollback mechanism. The Uniswap pool state remains changed. The product is an **insured settlement layer** that controls final settlement and absorbs user loss through reserves.

## 2. Problem

Uniswap swaps can be negatively affected by sandwich attacks and other MEV patterns. In a sandwich attack, an attacker places a trade before and after the victim trade, pushing the victim into a worse execution price and extracting value from the price movement.

For a normal wallet or router flow, the user receives the bad output and the transaction is considered complete. The protocol cannot simply unwind the pool state after the fact.

The practical user problem is:

- the user spent the input token;
- the output was worse than expected;
- the final recipient can still be paid as if the trade were normal;
- the user bears the execution loss;
- there is no built-in insurance or settlement hold.

AEGIS402 solves this by delaying final settlement and adding an insurance pool behind protected swaps.

## 3. Core Mechanism

The MVP uses the official Uniswap v4 contracts on a Sepolia fork:

- PoolManager: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`
- PoolSwapTest: `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`
- PoolModifyLiquidityTest: `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a`

The protected flow is:

1. The user submits an exact-input protected swap through `AegisProtectedSwapAdapter`.
2. The adapter collects the input amount plus a 50 bps protection fee.
3. The protection fee is sent to `InsurancePool`.
4. The swap is executed through the official Sepolia `PoolSwapTest`.
5. `AegisEscrowHook` runs in `afterSwap`.
6. If `hookData` is empty, the swap passes through normally.
7. If `hookData` contains a protected trade request, the hook uses Uniswap v4 custom accounting to redirect the full output delta to `EscrowVault`.
8. The vault records the trade as `Pending`.
9. The auditor either releases the escrowed output or pays an insurance claim.

The hook requires the Uniswap v4 permission bits:

```text
AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG
```

The test deployment mines a CREATE2 salt so the hook address has the required lower 14-bit permission pattern.

## 4. Contracts

### AegisEscrowHook

The hook is attached to a Uniswap v4 pool and only modifies swaps that include protected `hookData`.

For protected swaps, it:

- requires exact-input swaps;
- derives input and output tokens from the `PoolKey`;
- reads the actual output delta from the swap result;
- calls `PoolManager.take(outputCurrency, vault, outputAmount)`;
- records the escrow in `EscrowVault`;
- returns the output amount as the `afterSwapReturnDelta`, reducing the router's direct output to zero.

For unprotected swaps with empty `hookData`, it returns zero delta and does not escrow funds.

### EscrowVault

The vault stores protected swap records.

States:

```text
None
Pending
Released
ClaimPaid
```

The auditor can:

- `release(tradeId)`: send escrowed output to the settlement recipient;
- `payClaim(tradeId, reason)`: block recipient settlement, move escrowed output to the insurance pool, and ask the insurance pool to pay the user in the input token.

### InsurancePool

The insurance pool stores reserves and protection fees.

It:

- accepts reserve funding;
- records protection fee events from the authorized swap adapter;
- pays claims only when called by the vault;
- reverts if reserves are insufficient;
- receives recovered escrow output after failed audits.

### AegisProtectedSwapAdapter

The adapter gives users a simple protected exact-input swap entrypoint:

```solidity
protectedExactInputSingle(ProtectedSwapRequest request)
```

The request includes:

- `PoolKey key`
- `bool zeroForOne`
- `uint128 amountIn`
- `uint256 expectedOutput`
- `uint160 sqrtPriceLimitX96`
- `bytes32 tradeId`
- `address settlementRecipient`

The adapter pulls `amountIn + protectionFee` from the user, sends the fee to the insurance pool, approves the official `PoolSwapTest`, and passes protected hook data into the swap.

## 5. Demo Scenarios

### Normal Protected Swap

```text
User swaps token0 for token1.
Hook escrows token1 output.
Vault state becomes Pending.
Auditor marks the trade clean.
Vault releases token1 to the settlement recipient.
Insurance pool keeps the protection fee.
```

### Sandwich-Shaped Failure

```text
Attacker front-runs token0 -> token1.
Victim performs protected token0 -> token1 swap at a worse price.
Attacker back-runs token1 -> token0.
Auditor marks victim trade as SANDWICH.
Vault blocks settlement recipient release.
Insurance pool pays the victim the original token0 input amount.
Vault moves escrowed token1 output into the insurance pool as recovery.
```

### Unprotected Swap

```text
Swap uses empty hookData.
Hook returns zero afterSwap delta.
Output goes directly to the swap caller.
Vault remains unchanged.
```

## 6. MVP Scope

Included:

- ERC20/ERC20 pools only.
- Exact-input swaps only.
- One official Sepolia v4 PoolManager on a local fork.
- CREATE2 hook permission mining in tests.
- Protection fee collection.
- Escrow release.
- Insurance claim payout.
- Sandwich-shaped test using attacker front-run and back-run swaps.

Excluded:

- Native ETH support.
- Universal Router integration.
- Automated off-chain MEV detection.
- Multi-pool routing.
- Dynamic risk pricing.
- Production-grade governance and dispute process.

## 7. Success Criteria

The MVP is successful when:

- protected swap output is escrowed instead of delivered directly;
- clean audits release escrowed output to the intended recipient;
- failed audits block recipient settlement;
- failed audits pay the user the original input token amount from the insurance pool;
- escrowed output is recovered into the insurance pool;
- unprotected swaps still behave normally;
- duplicate trade IDs and insufficient insurance reserves revert.

## 8. Test Command

Use Node 22 and Hardhat:

```bash
npm install
npm run compile
npm run test:fork
```

By default the Hardhat fork uses:

```text
https://sepolia.gateway.tenderly.co
```

Set `SEPOLIA_RPC_URL` in `.env` to override the Sepolia fork RPC.
