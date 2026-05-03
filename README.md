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

The addresses below are the current Sepolia demo deployment with the audit-responsive escrow standard enabled.

| Contract | Sepolia address | Verified source |
| --- | --- | --- |
| AegisDemoDeployer | `0xb87A1BDB10B79dA2a5dB9EeDb8949c247Fd55bA2` | [Etherscan code](https://sepolia.etherscan.io/address/0xb87A1BDB10B79dA2a5dB9EeDb8949c247Fd55bA2#code) |
| Mock USDT | `0xdEFf5dE317F4636498a58D7D7dd0bc9c178e816f` | [Etherscan code](https://sepolia.etherscan.io/address/0xdEFf5dE317F4636498a58D7D7dd0bc9c178e816f#code) |
| Mock AEGIS | `0x788AAa4E8da43480d24FB900c6685274441DBBA0` | [Etherscan code](https://sepolia.etherscan.io/address/0x788AAa4E8da43480d24FB900c6685274441DBBA0#code) |
| InsurancePool | `0xFEA84989fAF5ee2Ee0e6413A4F6b67e1d7d7F341` | [Etherscan code](https://sepolia.etherscan.io/address/0xFEA84989fAF5ee2Ee0e6413A4F6b67e1d7d7F341#code) |
| EscrowVault | `0x014A0A4239bE3450bab6A59bba32BecC9e372bc3` | [Etherscan code](https://sepolia.etherscan.io/address/0x014A0A4239bE3450bab6A59bba32BecC9e372bc3#code) |
| AegisEscrowHook | `0x2d8b972f069D448040C4B8C3FfdD491fF25E8044` | [Etherscan code](https://sepolia.etherscan.io/address/0x2d8b972f069D448040C4B8C3FfdD491fF25E8044#code) |
| AegisProtectedSwapAdapter | `0x78159564738C31B0D31982256bBbE81bEE9aBc09` | [Etherscan code](https://sepolia.etherscan.io/address/0x78159564738C31B0D31982256bBbE81bEE9aBc09#code) |

Deployment transactions:

```text
AegisDemoDeployer: 0x3b2667dd15324547c2811c530636722d1f530f30a475e4b456b63e0d80d0e5c6
deployDemo: 0x5611b14dc0550b7d9600fdb011a5e77c63f9554750908842b887667ee605685b
```

Deployment blocks:

```text
AegisDemoDeployer: 10778501
deployDemo: 10778506
```

### Etherscan Verification

All current Sepolia demo contracts are verified on Etherscan. The verified source links are included in the deployment table above, and the same URLs are recorded in `deployments/sepolia-demo.json`.

Verification was performed with:

```bash
npx hardhat verify --network sepolia <contract-address> <constructor-args>
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
FORK_BLOCK_NUMBER=10778506 npm run e2e:deployed:fork
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
| Auditor | `0x85cF8af54eDa3A49aaFcf9f4f845E9dFB386efef` |
| User | `0x7321f0bE5Ec09f9a83CF95d5E5d32f6dAA9f6570` |
| Attacker | `0xAd26A9FEf273C836Fe6d76C0545f2128296A37a3` |

Normal case:

| Field | Value |
| --- | --- |
| Input | `100.0 USDT` |
| Protection fee | `0.5 USDT` |
| Audit action | `RELEASE` |
| Escrowed output | `99.69006090092817746 AEGIS` |
| Final state | `2` (`Released`) |
| User AEGIS after release | `99.69006090092817746 AEGIS` |

Extreme sandwich case:

| Field | Value |
| --- | --- |
| Victim input | `100.0 USDT` |
| Victim slippage model | max-loose price limit |
| Victim sqrt price limit | `4295128740` |
| Attacker front-run | `500000.0 USDT` |
| Attacker back-run | `332610.706184340546246963 AEGIS` |
| Audit action | `BLOCK_AND_CLAIM` |
| Clean-case output | `99.69006090092817746 AEGIS` |
| Attacked victim output | `44.391005624176152335 AEGIS` |
| Output shortfall | `55.299055276752025125 AEGIS` |
| Final state | `3` (`ClaimPaid`) |
| User USDT before claim | `19799.0 USDT` |
| User USDT after claim | `19899.0 USDT` |
| User AEGIS after claim | `99.69006090092817746 AEGIS` |
| Insurance AEGIS after recovery | `1000044.391005624176152335 AEGIS` |
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

Generated actors were funded with `0.005` Sepolia ETH each from the deployment key.

| Role | Address |
| --- | --- |
| Auditor | `0x94fD94a8BD99A20D5A0f3D65BB99502E062Dda38` |
| User | `0xA92B64722af987B97481be3b2Ef6bB79D8ccbC22` |
| Attacker | `0x252Df5860a4583647904A59bA67A9dd9C46EB90d` |

Normal case:

| Field | Value |
| --- | --- |
| Input | `100.0 USDT` |
| Protection fee | `0.5 USDT` |
| Audit action | `RELEASE` |
| Escrowed output | `99.541251236045274067 AEGIS` |
| Final state | `2` (`Released`) |
| User AEGIS after release | `99.541251236045274067 AEGIS` |

Normal case transaction hashes:

| Step | Sepolia transaction |
| --- | --- |
| User mints USDT | [`0x22125e7822b4f727dedb166b3463a416345c9aae2914de38b4ab1ac521e96dc4`](https://sepolia.etherscan.io/tx/0x22125e7822b4f727dedb166b3463a416345c9aae2914de38b4ab1ac521e96dc4) |
| User approves adapter | [`0x537aaf550082f8820b2e41250b7e6af9c843c54aa9f733dcccfac63f3bb7a191`](https://sepolia.etherscan.io/tx/0x537aaf550082f8820b2e41250b7e6af9c843c54aa9f733dcccfac63f3bb7a191) |
| Protected swap escrowed | [`0x9c55902631bed51d5a37e205a0eb1fd86eb84be0f7293c6aaf6161b86869e946`](https://sepolia.etherscan.io/tx/0x9c55902631bed51d5a37e205a0eb1fd86eb84be0f7293c6aaf6161b86869e946) |
| Audit `RELEASE` | [`0x7e10d76a184506605b964981df9556b141acefd6e7610681665a564231dfc3ca`](https://sepolia.etherscan.io/tx/0x7e10d76a184506605b964981df9556b141acefd6e7610681665a564231dfc3ca) |

Extreme sandwich case:

| Field | Value |
| --- | --- |
| Victim input | `100.0 USDT` |
| Victim slippage model | max-loose price limit |
| Victim sqrt price limit | `4295128740` |
| Attacker front-run | `500000.0 USDT` |
| Attacker back-run | `426823.547013306836346846 AEGIS` |
| Audit action | `BLOCK_AND_CLAIM` |
| Clean-case output | `99.541251236045274067 AEGIS` |
| Attacked victim output | `73.207519328954046387 AEGIS` |
| Output shortfall | `26.33373190709122768 AEGIS` |
| Final state | `3` (`ClaimPaid`) |
| User USDT before claim | `19799.0 USDT` |
| User USDT after claim | `19899.0 USDT` |
| User AEGIS after claim | `99.541251236045274067 AEGIS` |
| Insurance USDT after claim | `999802.5 USDT` |
| Insurance AEGIS after recovery | `1000137.074316917335233568 AEGIS` |
| Vault AEGIS after claim | `0.0 AEGIS` |

Extreme sandwich case transaction hashes:

| Step | Sepolia transaction |
| --- | --- |
| Attacker mints USDT | [`0x4202a447c44908cc910bb8bcd54dccd81e672947d8db5e9e5b2d4083c49205ca`](https://sepolia.etherscan.io/tx/0x4202a447c44908cc910bb8bcd54dccd81e672947d8db5e9e5b2d4083c49205ca) |
| Attacker approves USDT | [`0x98448d450e0646884adb49eb7111d8adaf9adfc88e280559e37cc96b1f400017`](https://sepolia.etherscan.io/tx/0x98448d450e0646884adb49eb7111d8adaf9adfc88e280559e37cc96b1f400017) |
| Attacker front-run swap | [`0xc4cc487ce64adfb47fc7b8453844617f033ac36e59acf3b006a4d50f999f7899`](https://sepolia.etherscan.io/tx/0xc4cc487ce64adfb47fc7b8453844617f033ac36e59acf3b006a4d50f999f7899) |
| Victim mints USDT | [`0x09b58a185a60012b0c80bd57183ba383bd1fa59468653823489446ee8dea2dd7`](https://sepolia.etherscan.io/tx/0x09b58a185a60012b0c80bd57183ba383bd1fa59468653823489446ee8dea2dd7) |
| Victim approves adapter | [`0x2914ed6a9cf5c146f57f10a5fd3a8e00064f6e73a35e43a154650be1a61b00f0`](https://sepolia.etherscan.io/tx/0x2914ed6a9cf5c146f57f10a5fd3a8e00064f6e73a35e43a154650be1a61b00f0) |
| Victim protected swap escrowed | [`0xbb146dc17fcce5294bb67fd3eebc57822ba157bb58e8b2c601006e5b3202c39e`](https://sepolia.etherscan.io/tx/0xbb146dc17fcce5294bb67fd3eebc57822ba157bb58e8b2c601006e5b3202c39e) |
| Attacker approves AEGIS | [`0xbee6820d00373b3d1ae277d0a77e2ab0681599513c098a763f94f2af020542cd`](https://sepolia.etherscan.io/tx/0xbee6820d00373b3d1ae277d0a77e2ab0681599513c098a763f94f2af020542cd) |
| Attacker back-run swap | [`0x31e822718969569c5ef8f9f6a80ff725e86f1363881e29186bc6fdf023f69beb`](https://sepolia.etherscan.io/tx/0x31e822718969569c5ef8f9f6a80ff725e86f1363881e29186bc6fdf023f69beb) |
| Audit `BLOCK_AND_CLAIM` | [`0x7484f8b5481d03f9d285f3b0860beace6602e51be1fe1b18a280f7621b46c1cf`](https://sepolia.etherscan.io/tx/0x7484f8b5481d03f9d285f3b0860beace6602e51be1fe1b18a280f7621b46c1cf) |

Conclusion:

```text
PASS: deployed USDT/AEGIS demo released clean settlement and paid insurance on the extreme loose-slippage sandwich case.
```

## Notes

- The live pool was initialized once on Sepolia. Later E2E runs skip initialization and add more liquidity.
- The live E2E scripts use the standard `executeAuditDecision` entrypoint for both `RELEASE` and `BLOCK_AND_CLAIM`.
- Public non-archive Sepolia RPCs may fail local fork tests at historical blocks. The recorded fork result used `FORK_BLOCK_NUMBER=10778506` with an archive-capable Sepolia RPC.
- A production system should replace the single auditor EOA with multisig, role-based access, or another governed attestation path.
