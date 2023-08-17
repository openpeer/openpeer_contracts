# OpenPeer contracts

```shell
  OpenPeerEscrow
    ✓ Should return a version recipient
    Create
      Validations
        ✓ Should deploy successfully
        Native token
          ✓ Should revert with 0 amount
          ✓ Should revert with same buyer and seller
          ✓ Should revert with burn address as buyer
          ✓ Should revert with an already deployed order
          With partner fee
            ✓ Should revert with an incorrect amount
          With an invalid seller waiting time
            ✓ Should revert with less than 15 min
            ✓ Should revert with more than 24 hours
        ERC20 token
          ✓ Should revert with 0 amount
          ✓ Should revert with same buyer and seller
          ✓ Should revert with burn address as buyer
          ✓ Should revert with an already deployed order
          With an invalid seller waiting time
            ✓ Should revert with less than 15 min
            ✓ Should revert with more than 24 hours
      Native token
        ✓ Should emit a EscrowCreated event
        ✓ Should be available in the escrows list
        ✓ Should revert with a smaller amount
        ✓ Should revert with a bigger amount
        ✓ Should transfer funds to the escrow contract
        With a partner fee
          ✓ Should use the correct amount
        Escrow struct
          ✓ Should generate the right struct
          With small amounts
            ✓ Should calculate the right fee
      ERC20 token
        ✓ Should emit a EscrowCreated event
        ✓ Should be available in the escrows list
        ✓ Should transfer funds to the escrow contract
        With a partner fee
          ✓ Should use the correct amount
        Escrow struct
          ✓ Should generate the right struct
          With small amounts
            ✓ Should calculate the right fee
    Release
      Native token
        ✓ Should fail with a not found escrow
        ✓ Should revert with an address different than seller
        ✓ Should emit the Released event
        ✓ Should transfer funds to the buyer and fee recipient
        With a dispute
          When only the seller paid
            ✓ Should return the dispute fee to the seller
          When only the buyer paid
            ✓ Should return the dispute fee to the buyer
          When both parts paid
            ✓ Should return the dispute fee to the winner
        With partner fee
          ✓ Should transfer funds to the buyer and fee recipient
      ERC20 token
        ✓ Should fail with a not found escrow
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
        With partner fee
          ✓ Should transfer funds to the buyer and fee recipient
    Buyer cancel
      Native token
        ✓ Should fail with a not found escrow
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
        With partner fee
          ✓ Should transfer funds to the seller
      ERC20 token
        ✓ Should fail with a not found escrow
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
        With partner fee
          ✓ Should transfer funds to the seller
    Seller cancel
      Native token
        ✓ Should fail with a not found escrow
        ✓ Should revert with an address different than buyer
        ✓ Should not transfer funds if the seller cannot cancel
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledBySeller event
        With partner fee
          ✓ Should transfer funds to the seller
      ERC20 token
        ✓ Should fail with a not found escrow
        ✓ Should revert with an address different than seller
        ✓ Should not transfer funds if the seller cannot cancel
        ✓ Should transfer funds to the seller
        ✓ Should emit the CancelledBySeller event
        With partner fee
          ✓ Should transfer funds to the seller
    Mark as paid
      Native token
        ✓ Should revert with an address different than buyer
        ✓ Should set sellerCanCancelAfter as 1
        ✓ Should emit the SellerCancelDisabled event
        ✓ Should fail with a not found escrow
    Open dispute
      ✓ Should fail with a not found escrow
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
        ✓ Should revert with if the buyer did not mark as paid
      ERC20 token
        ✓ Should revert with if the buyer did not mark as paid
    Resolve dispute
      ✓ Should revert with an address different than arbitrator
      ✓ Should revert if the dispute is not open
      ✓ Should revert with a wrong winner
      ✓ Should emit an DisputeResolved event
      ✓ Should fail with a not found escrow
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
          With partner fee
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
        ERC20 token
          Without partner fee
            When only the seller paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer
            When only the buyer paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer
            When both parts paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer
          With partner fee
            When only the seller paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer
            When only the buyer paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer
            When both parts paid
              With the seller as winner
                ✓ Should return the tokens to the seller
                ✓ Should return the fee to the seller
              With the buyer as winner
                ✓ Should return the tokens to the buyer
                ✓ Should return the fee to the buyer

  OpenPeerEscrowsDeployer
    Deployment
      ✓ Should deploy successfully
      ✓ Should initialize the implementation
    Settings
      ✓ Should update the fee
      ✓ Should update the fee recipient
      ✓ Should update the arbitrator
      Validations
        ✓ Should revert with non owner tries to update the fee
        ✓ Should revert with non owner tries to update the fee recipient
        ✓ Should revert with non owner tries to update the arbitrator
        ✓ Should revert with non owner tries to update the trustedForwarder
        ✓ Should revert with non owner tries to update the implementation
        ✓ Should revert with non owner tries to update the feeDiscountNFT
        ✓ Should revert with non owner tries to toggle the contract active
    Fees
      With the fees discount NFT
        ✓ Should return fee with a 100% discount
      Without the fees discount NFT
        ✓ Should return fee without discounts
      With a seller fee
        ✓ Should return fee with the seller fee
      Updating the partner fees
        ✓ Should revert with non owner tries to update the partner fees
        ✓ Should revert with different array lengths
        ✓ Should revert with invalid fee
        ✓ Should revert with invalid address
        ✓ Should update the partner fees
    Deploy
      ✓ Should emit a ContractCreated event
      ✓ Should be available in the seller contracts
      Multiple contracts per seller
        ✓ Should create a second contract for the same seller

  VP2P
    Deployment
      ✓ Should deploy successfully
      ✓ Should initialize the implementation
      ✓ Should revert if initialize is called twice
    Initialized
      Create round
        ✓ Should create a round
        ✓ Should create multiple rounds
        ✓ Should revert if round exists
        ✓ Should revert end date is in the past
        ✓ Should revert if not owner
      Claim
        ✓ Should claim tokens
        ✓ Should revert if round does not exist
        ✓ Should revert if tokens have already been claimed
        ✓ Should revert if amount is invalid
        ✓ Should revert if user is invalid
        ✓ Should transfer the values
        ✓ Should transfer the values

·---------------------------------------------------|----------------------------|-------------|-----------------------------·
|               Solc version: 0.8.17                ·  Optimizer enabled: false  ·  Runs: 200  ·  Block limit: 30000000 gas  │
····················································|····························|·············|······························
|  Methods                                                                                                                   │
····························|·······················|··············|·············|·············|···············|··············
|  Contract                 ·  Method               ·  Min         ·  Max        ·  Avg        ·  # calls      ·  usd (avg)  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  buyerCancel          ·       54768  ·      84660  ·      66629  ·           32  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  createERC20Escrow    ·      125186  ·     185138  ·     169951  ·           67  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  createNativeEscrow   ·       75829  ·     135781  ·     117509  ·          108  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  markAsPaid           ·       45673  ·      45913  ·      45744  ·          102  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  openDispute          ·       67236  ·      87376  ·      79453  ·           82  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  release              ·       65779  ·     132636  ·      96734  ·           39  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  resolveDispute       ·       76811  ·     146346  ·     112806  ·          117  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrow           ·  sellerCancel         ·       41487  ·      63235  ·      55043  ·           27  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  deploy               ·      227119  ·     244219  ·     244099  ·          143  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setArbitrator        ·           -  ·          -  ·      31627  ·            1  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFee               ·           -  ·          -  ·      31244  ·            1  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFeeDiscountNFT    ·           -  ·          -  ·      48670  ·            1  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  setFeeRecipient      ·           -  ·          -  ·      31582  ·            1  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer  ·  updatePartnerFeeBps  ·           -  ·          -  ·      50736  ·           29  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  Token                    ·  approve              ·           -  ·          -  ·      46852  ·          138  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  VP2P                     ·  claim                ·           -  ·          -  ·      97330  ·            6  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  VP2P                     ·  createRound          ·           -  ·          -  ·      69327  ·           11  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  VP2P                     ·  initialize           ·           -  ·          -  ·     116202  ·           14  ·          -  │
····························|·······················|··············|·············|·············|···············|··············
|  Deployments                                      ·                                          ·  % of limit   ·             │
····················································|··············|·············|·············|···············|··············
|  NFT                                              ·           -  ·          -  ·    2097164  ·          7 %  ·          -  │
····················································|··············|·············|·············|···············|··············
|  OpenPeerEscrowsDeployer                          ·           -  ·          -  ·    5850235  ·       19.5 %  ·          -  │
····················································|··············|·············|·············|···············|··············
|  Token                                            ·           -  ·          -  ·    1168929  ·        3.9 %  ·          -  │
····················································|··············|·············|·············|···············|··············
|  VP2P                                             ·           -  ·          -  ·    2444499  ·        8.1 %  ·          -  │
·---------------------------------------------------|--------------|-------------|-------------|---------------|-------------·

  176 passing (14s)
```
