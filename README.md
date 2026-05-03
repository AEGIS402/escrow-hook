# AEGIS402 Insured Escrow Hook MVP

This repository contains a Hardhat MVP for an insured escrow Uniswap v4 hook.

The demo pair is:

- `Mock USDT` / `USDT`
- `Mock AEGIS` / `AEGIS`

Both mock tokens use 18 decimals and expose unrestricted public `mint(address,uint256)` functions. Any address can mint either token for demo and test usage.

## Audit-Responsive Escrow Standard

The reusable standard is split into:

- `IAegisAuditEscrow`: the public interface watched and called by audit agents.
- `AegisAuditEscrowBase`: the abstract base contract inherited by concrete escrow implementations.

Any contract that follows the standard emits `EscrowRegistered` when funds enter a pending escrow and exposes:

```solidity
executeAuditDecision(AuditDecision decision)
```

`AuditDecision` contains:

- `escrowId`: the standardized escrow identifier.
- `action`: one of `RELEASE`, `BLOCK_AND_CLAIM`, `RECOVER_TO_RESERVE`, or `CUSTOM`.
- `reason`: a compact reason code such as `CLEAN` or `SANDWICH`.
- `evidenceHash`: a hash or URI hash for off-chain audit evidence.
- `actionData`: implementation-specific data for advanced actions.

The base contract enforces:

- only the configured `auditAgent` can execute audit decisions;
- each escrow can be resolved only once;
- unknown escrow ids cannot be resolved;
- concrete contracts decide how each action changes funds.

In this demo, `EscrowVault` inherits the base contract. The protected Uniswap swap `tradeId` is the concrete `escrowId`.

| Standard action | EscrowVault behavior |
| --- | --- |
| `RELEASE` | Send escrowed AEGIS output to the settlement recipient. |
| `BLOCK_AND_CLAIM` | Block recipient settlement, recover escrowed AEGIS into `InsurancePool`, and pay the user the original USDT input amount. |
| `RECOVER_TO_RESERVE` | Recover escrowed output into `InsurancePool` without a user claim payment. |
| `CUSTOM` | Reverts in this MVP implementation. |

Compatibility helpers remain available:

```solidity
release(tradeId)
payClaim(tradeId, reason)
```

Both helpers route through the same standardized audit-decision path.

## Fee Model

The AEGIS protection fee is charged in addition to the Uniswap pool swap fee.

```text
user total payment = swap input amount + AEGIS protection fee
AEGIS protection fee = input amount * 0.5%
```

For a `100.0 USDT` protected swap:

```text
100.0 USDT goes into the Uniswap v4 swap
0.5 USDT goes to the InsurancePool
100.5 USDT total is pulled from the user
```

## Official Sepolia Uniswap v4 Contracts

The demo uses the official Uniswap v4 Sepolia deployments:

- PoolManager: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`
- PoolSwapTest: `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee`
- PoolModifyLiquidityTest: `0x0c478023803a644c94c4ce1c1e7b9a087e411b0a`

## Sepolia Deployment

Deployment is handled by `AegisDemoDeployer`.

`AegisDemoDeployer` is deployed first. Then one `deployDemo(...)` call deploys all demo contracts with CREATE2:

- Mock USDT
- Mock AEGIS
- InsurancePool
- EscrowVault
- AegisEscrowHook
- AegisProtectedSwapAdapter

The hook salt is mined off-chain so the hook address has the required Uniswap v4 permission bits:

```text
AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG
```

Fresh deployments created by the current deploy script include the audit-responsive escrow standard metadata in `deployments/sepolia-demo.json`.

### Deployed Addresses

The addresses below are the previously recorded Sepolia demo deployment. They remain valid for the legacy live-demo scripts. Redeploy with `npm run deploy:sepolia` to get fresh bytecode that includes the new `executeAuditDecision` standard entrypoint.

| Contract | Sepolia address |
| --- | --- |
| AegisDemoDeployer | `0x95193B89c680ED1669Cc375205756d72dD45A88b` |
| Mock USDT | `0x325c88Ea79e350A35718d4e82940700C61FF0d43` |
| Mock AEGIS | `0xE756526ebCfEfdb224Bf129636e377486d8B11b6` |
| InsurancePool | `0x94e0fB9AcCfB6AeCDf35CF9e00d5bAfad5D4113d` |
| EscrowVault | `0x4D54Bb8624Ad1267474121ECefb6E53c042F0748` |
| AegisEscrowHook | `0x24e277f3C03Fa7a5A37Be6aB170284328e738044` |
| AegisProtectedSwapAdapter | `0xC65A5a2Fea2Ef73A93aFFB940d4280664fB664B8` |

Deployment transaction:

```text
deployDemo: 0x94cfc6bc2dccb482028e4c2bf78cbf4314e74e36efdba5f178ec461ea5e2db48
```

Initial insurance reserves minted directly into `InsurancePool`:

| Token | Amount |
| --- | --- |
| USDT | `1000000.0` |
| AEGIS | `1000000.0` |

The deployment output is stored in:

```text
deployments/sepolia-demo.json
```

## Commands

Install and compile:

```bash
nvm use
npm install
npm run compile
```

Deploy the Sepolia demo:

```bash
npm run deploy:sepolia
```

Run the original local fork unit/E2E tests:

```bash
npm run test:standard
npm run test:fork
npm run e2e
```

Run E2E against the deployed Sepolia addresses on a local Hardhat fork:

```bash
FORK_BLOCK_NUMBER=10778295 npm run e2e:deployed:fork
```

Run E2E on live Sepolia:

```bash
npm run e2e:sepolia
```

The sandwich scripts default to an intentionally extreme loose-slippage case. The victim uses the loosest one-sided v4 price limit, and the attacker front-runs with `500000.0 USDT` by default.

Override the attack size with:

```bash
ATTACK_AMOUNT=750000 npm run e2e:sepolia
```

## Deployed Fork E2E Result

Result file:

```text
deployments/sepolia-fork-e2e.json
```

Generated actors:

| Role | Address |
| --- | --- |
| Auditor | `0x1285AF84C5a67972Da53Ae5A126f4CF08081425b` |
| User | `0xa12cbDDc555eC6E3290677E82c5442De330917EF` |
| Attacker | `0xBB5DcD326bE5984240D0AdD1852757184F515fBE` |

Normal case:

| Field | Value |
| --- | --- |
| Input | `100.0 USDT` |
| Protection fee | `0.5 USDT` |
| Escrowed output | `99.373567686168735429 AEGIS` |
| Final state | `2` (`Released`) |
| User AEGIS after release | `99.373567686168735429 AEGIS` |

Extreme sandwich case:

| Field | Value |
| --- | --- |
| Victim input | `100.0 USDT` |
| Victim slippage model | max-loose price limit |
| Victim sqrt price limit | `4295128740` |
| Attacker front-run | `500000.0 USDT` |
| Attacker back-run | `441877.41186647705326863 AEGIS` |
| Clean-case output | `99.373567686168735429 AEGIS` |
| Attacked victim output | `78.59481727368501012 AEGIS` |
| Output shortfall | `20.778750412483725309 AEGIS` |
| Final state | `3` (`ClaimPaid`) |
| User USDT before claim | `19799.0 USDT` |
| User USDT after claim | `19899.0 USDT` |
| User AEGIS after claim | `99.373567686168735429 AEGIS` |
| Insurance AEGIS after recovery | `1000196.147851586084447108 AEGIS` |
| Vault AEGIS after claim | `0.0 AEGIS` |

Conclusion:

```text
PASS: deployed USDT/AEGIS demo released clean settlement and paid insurance on the extreme loose-slippage sandwich case.
```

## Live Sepolia E2E Result

Result file:

```text
deployments/sepolia-live-e2e.json
```

Generated actors were funded with `0.05` Sepolia ETH each from the deployment key.

| Role | Address |
| --- | --- |
| Auditor | `0x2514Dc48477596401Dd42d0d7e32FF7196F35D35` |
| User | `0x956101cAc7B217AF87dacFd1aD04a210DaFB4186` |
| Attacker | `0x21096Ec5e85d2Bd2796D7C8280812AA0D922a601` |

Normal case:

| Field | Value |
| --- | --- |
| Input | `100.0 USDT` |
| Protection fee | `0.5 USDT` |
| Escrowed output | `99.469130600316193542 AEGIS` |
| Final state | `2` (`Released`) |
| User AEGIS after release | `99.469130600316193542 AEGIS` |

Extreme sandwich case:

| Field | Value |
| --- | --- |
| Victim input | `100.0 USDT` |
| Victim slippage model | max-loose price limit |
| Victim sqrt price limit | `4295128740` |
| Attacker front-run | `500000.0 USDT` |
| Attacker back-run | `426536.311279936476934158 AEGIS` |
| Clean-case output | `99.469130600316193542 AEGIS` |
| Attacked victim output | `73.162028688223284653 AEGIS` |
| Output shortfall | `26.307101912092908889 AEGIS` |
| Final state | `3` (`ClaimPaid`) |
| User USDT before claim | `19799.0 USDT` |
| User USDT after claim | `19899.0 USDT` |
| User AEGIS after claim | `99.469130600316193542 AEGIS` |
| Insurance USDT after claim | `999802.0 USDT` |
| Insurance AEGIS after recovery | `1000117.553034312399436988 AEGIS` |
| Vault AEGIS after claim | `0.0 AEGIS` |

Conclusion:

```text
PASS: deployed USDT/AEGIS demo released clean settlement and paid insurance on the extreme loose-slippage sandwich case.
```

## Notes

- The live pool was initialized once on Sepolia. Later E2E runs skip initialization and add more liquidity.
- The first `AegisDemoDeployer` transaction succeeded, while the first oversized `deployDemo` attempt was rejected by the RPC before broadcast. The recorded `deployDemo` transaction above is the successful one-call deployment for the demo contracts.
- A production system should replace the single auditor EOA with multisig, role-based access, or another governed attestation path.
