# OpenPeer contracts

```shell

  OpenPeerEscrow
    Deployment
      ✓ Should deploy successfully
      Validations
        ✓ Should revert with 0 amount
        ✓ Should revert with same buyer and seller
        ✓ Should revert with burn address as buyer
      With small amounts
        ✓ Should calculate the right fee
    Escrow
      Native token
        ✓ Should revert if funds were escrowed already
        ✓ Should revert with a smaller amount
        ✓ Should revert with a bigger amount
        ✓ Should set the time when the seller can cancel
        ✓ Should transfer funds to the escrow contract
        ✓ Should emit the Created event
      ERC20 tokens
        ✓ Should revert if funds were escrowed already
        ✓ Should set the time when the seller can cancel
        ✓ Should transfer funds to the escrow contract
        ✓ Should emit the Created event
    Release
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the buyer and fee recipient
        ✓ Should emit the Released event
      ERC20 tokens
        ✓ Should revert with an address different than seller
        ✓ Should transfer funds to the buyer and fee recipient
        ✓ Should emit the Released event
    Buyer cancel
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledByBuyer event
      ERC20 tokens
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledByBuyer event
    Seller cancel
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should not transfer funds if the seller cannot cancel
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledBySeller event
      ERC20 tokens
        ✓ Should revert with an address different than seller
        ✓ Should not transfer funds if the seller cannot cancel
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledBySeller event
    Buyer cancel
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the seller
        ✓ Should emit the SellerCancelDisabled event
    Open dispute
      ✓ Should revert with an address different than seller or buyer
      ✓ Should revert with if the funds were not escrowed
      ✓ Should open a dispute from seller
      ✓ Should open a dispute from buyer
      ✓ Should emit an DisputeOpened event
    Resolve dispute
      ✓ Should revert with an address different than arbitrator
      ✓ Should revert if the dispute is not open
      ✓ Should revert with a wrong winner
      ✓ Should emit an DisputeResolved event
      Valid resolutions
        Native token
          ✓ Should result with the seller as winner
          ✓ Should result with the buyer as winner
        ERC20 tokens
          ✓ Should result with the seller as winner
          ✓ Should result with the buyer as winner

  OpenPeerEscrowsDeployer
    Deployment
      ✓ Should deploy successfully
      Settings
        ✓ Should update the fee
        ✓ Should update the fee recipient
        ✓ Should update the arbitrator
        Validations
          ✓ Should revert with non owner tries to update the fee
          ✓ Should revert with non owner tries to update the fee recipient
          ✓ Should revert with non owner tries to update the arbitrator
      Native token
        ✓ Should emit a EscrowCreated event
        ✓ Should save the new escrow data
      ERC20 tokens
        ✓ Should emit a EscrowCreated event
        ✓ Should save the new escrow data

·--------------------------------------------------|----------------------------|-------------|-----------------------------·
|               Solc version: 0.8.17               ·  Optimizer enabled: false  ·  Runs: 200  ·  Block limit: 30000000 gas  │
···················································|····························|·············|······························
|  Methods                                                                                                                  │
····························|······················|··············|·············|·············|···············|··············
|  Contract                 ·  Method              ·  Min         ·  Max        ·  Avg        ·  # calls      ·  usd (avg)  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  buyerCancel         ·       34495  ·      37042  ·      35910  ·            9  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  escrow              ·       27843  ·      73221  ·      47696  ·           48  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  markAsPaid          ·           -  ·          -  ·      29699  ·            3  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  openDispute         ·       29756  ·      30076  ·      29788  ·           10  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  release             ·       46202  ·      82993  ·      67663  ·           12  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  resolveDispute      ·       49029  ·      85849  ·      66693  ·           16  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  sellerCancel        ·       26213  ·      39484  ·      33658  ·           18  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  deployERC20Escrow   ·           -  ·          -  ·    1862228  ·            3  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  deployNativeEscrow  ·           -  ·          -  ·    1861597  ·            3  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setArbitrator       ·           -  ·          -  ·      26486  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFee              ·           -  ·          -  ·      31327  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFeeRecipient     ·           -  ·          -  ·      31285  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  Token                    ·  approve             ·       46840  ·      46852  ·      46851  ·           16  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  Deployments                                     ·                                          ·  % of limit   ·             │
···················································|··············|·············|·············|···············|··············
|  OpenPeerEscrow                                  ·     1971073  ·    1971325  ·    1971153  ·        6.6 %  ·          -  │
···················································|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer                         ·           -  ·          -  ·    3443089  ·       11.5 %  ·          -  │
···················································|··············|·············|·············|···············|··············
|  Token                                           ·           -  ·          -  ·    1168929  ·        3.9 %  ·          -  │
·--------------------------------------------------|--------------|-------------|-------------|---------------|-------------·

  62 passing (5s)


```
