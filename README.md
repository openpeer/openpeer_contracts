# OpenPeer contracts

```shell

  OpenPeerEscrow
    ✓ Should return a version recipient
    Deployment
      ✓ Should deploy successfully
      Validations
        ✓ Should revert with 0 amount
        ✓ Should revert with same buyer and seller
        ✓ Should revert with burn address as buyer
      With small amounts
        ✓ Should calculate the right fee
    Release
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the buyer and fee recipient
        ✓ Should emit the Released event
        With a dispute
          When only the seller paid
            ✓ Should return the dispute fee to the seller
          When only the buyer paid
            ✓ Should return the dispute fee to the buyer
          When both parts paid
            ✓ Should return the dispute fee to the winner
      ERC20 tokens
        ✓ Should revert with an address different than seller
        ✓ Should transfer funds to the buyer and fee recipient
        ✓ Should emit the Released event
        With a dispute
          When only the seller paid
            ✓ Should return the dispute fee to the seller
          When only the buyer paid
            ✓ Should return the dispute fee to the buyer
          When both parts paid
            ✓ Should return the dispute fee to the winner
    Buyer cancel
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledByBuyer event
        With a dispute
          When only the seller paid
            ✓ Should return the dispute fee to the seller
          When only the buyer paid
            ✓ Should return the dispute fee to the buyer
          When both parts paid
            ✓ Should return the dispute fee to the winner
      ERC20 tokens
        ✓ Should revert with an address different than buyer
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledByBuyer event
        With a dispute
          When only the seller paid
            ✓ Should return the dispute fee to the seller
          When only the buyer paid
            ✓ Should return the dispute fee to the buyer
          When both parts paid
            ✓ Should return the dispute fee to the winner
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
    Mark as paid
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should set sellerCanCancelAfter as 1
        ✓ Should emit the SellerCancelDisabled event
    Open dispute
      ✓ Should revert with an address different than seller or buyer
      As the seller
        ✓ Should revert if there is no dispute payment
        ✓ Should revert if there is not enough for the dispute payment
        ✓ Should revert with more than the dispute fee value
        ✓ Should revert if the user already paid
        ✓ Should mark the dispute as paid by the seller
        ✓ Should transfer 1 MATIC to the contract
        ✓ Should return true
        ✓ Should emit an DisputeOpened event
      As the buyer
        ✓ Should revert if there is no dispute payment
        ✓ Should revert if there is not enough for the dispute payment
        ✓ Should revert with more than the dispute fee value
        ✓ Should revert if the user already paid
        ✓ Should mark the dispute as paid by the buyer
        ✓ Should transfer 1 MATIC to the contract
        ✓ Should return true
        ✓ Should emit an DisputeOpened event
      Native token
        ✓ Should revert with if there are no funds
        ✓ Should revert with if the buyer did not mark as paid
      ERC20 token
        ✓ Should revert with if there are no funds
        ✓ Should revert with if the buyer did not mark as paid
    Resolve dispute
      ✓ Should revert with an address different than arbitrator
      ✓ Should revert if the dispute is not open
      ✓ Should revert with a wrong winner
      ✓ Should emit an DisputeResolved event
      Valid resolutions
        Native token
          When only the seller paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer
          When only the buyer paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer
          When both parts paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer
        ERC20 tokens
          When only the seller paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer
          When only the buyer paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer
          When both parts paid
            With the seller as winner
              ✓ Should return the tokens to the seller
            With the buyer as winner
              ✓ Should return the tokens to the buyer

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
        ✓ Should revert with an already deployed order
    Escrow
      Native token
        ✓ Should emit a EscrowCreated event
        ✓ Should be available in the escrows list
        ✓ Should revert with a smaller amount
        ✓ Should revert with a bigger amount
        ✓ Should transfer funds to the escrow contract
      ERC20 tokens
        ✓ Should emit a EscrowCreated event
        ✓ Should be available in the escrows list
        ✓ Should transfer funds to the escrow contract

·--------------------------------------------------|----------------------------|-------------|-----------------------------·
|               Solc version: 0.8.17               ·  Optimizer enabled: false  ·  Runs: 200  ·  Block limit: 30000000 gas  │
···················································|····························|·············|······························
|  Methods                                                                                                                  │
····························|······················|··············|·············|·············|···············|··············
|  Contract                 ·  Method              ·  Min         ·  Max        ·  Avg        ·  # calls      ·  usd (avg)  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  buyerCancel         ·       53013  ·      78163  ·      62519  ·           27  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  markAsPaid          ·           -  ·          -  ·      34523  ·           55  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  openDispute         ·       60460  ·      69254  ·      63453  ·           50  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  release             ·       64812  ·     122342  ·      90304  ·           34  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  resolveDispute      ·       71885  ·     125728  ·      95781  ·           34  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  sellerCancel        ·       31059  ·      58160  ·      47687  ·           18  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  deployERC20Escrow   ·           -  ·          -  ·     448143  ·           32  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  deployNativeEscrow  ·      348393  ·     368305  ·     368073  ·           86  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setArbitrator       ·           -  ·          -  ·      26530  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFee              ·           -  ·          -  ·      31218  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFeeRecipient     ·           -  ·          -  ·      26551  ·            1  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  Token                    ·  approve             ·           -  ·          -  ·      46852  ·           25  ·          -  │
····························|······················|··············|·············|·············|···············|··············
|  Deployments                                     ·                                          ·  % of limit   ·             │
···················································|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer                         ·           -  ·          -  ·    5040802  ·       16.8 %  ·          -  │
···················································|··············|·············|·············|···············|··············
|  Token                                           ·           -  ·          -  ·    1168929  ·        3.9 %  ·          -  │
·--------------------------------------------------|--------------|-------------|-------------|---------------|-------------·


```
