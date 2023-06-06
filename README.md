# OpenPeer contracts

```shell
  OpenPeerEscrow
    ✔ Should return a version recipient
    Create
      Validations
        ✔ Should deploy successfully
        Native token
          ✔ Should revert with 0 amount
          ✔ Should revert with same buyer and seller
          ✔ Should revert with burn address as buyer
          ✔ Should revert with an already deployed order
        ERC20 token
          ✔ Should revert with 0 amount
          ✔ Should revert with same buyer and seller
          ✔ Should revert with burn address as buyer
          ✔ Should revert with an already deployed order
      Native token
        ✔ Should emit a EscrowCreated event
        ✔ Should be available in the escrows list
        ✔ Should revert with a smaller amount
        ✔ Should revert with a bigger amount
        ✔ Should transfer funds to the escrow contract
        Escrow struct
          ✔ Should generate the right struct
          With small amounts
            ✔ Should calculate the right fee
      ERC20 token
        ✔ Should emit a EscrowCreated event
        ✔ Should be available in the escrows list
        ✔ Should transfer funds to the escrow contract (47ms)
        Escrow struct
          ✔ Should generate the right struct
          With small amounts
            ✔ Should calculate the right fee
    Release
      Native token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than seller
        ✔ Should transfer funds to the buyer and fee recipient
        ✔ Should emit the Released event
        With a dispute
          When only the seller paid
            ✔ Should return the dispute fee to the seller
          When only the buyer paid
            ✔ Should return the dispute fee to the buyer
          When both parts paid
            ✔ Should return the dispute fee to the winner
      ERC20 token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than seller
        ✔ Should transfer funds to the buyer and fee recipient (40ms)
        ✔ Should emit the Released event
        With a dispute
          When only the seller paid
            ✔ Should return the dispute fee to the seller
          When only the buyer paid
            ✔ Should return the dispute fee to the buyer
          When both parts paid
            ✔ Should return the dispute fee to the winner (41ms)
    Buyer cancel
      Native token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than buyer
        ✔ Should transfer funds to the seller
        ✔ Should emit the CancelledByBuyer event
        With a dispute
          When only the seller paid
            ✔ Should return the dispute fee to the seller
          When only the buyer paid
            ✔ Should return the dispute fee to the buyer
          When both parts paid
            ✔ Should return the dispute fee to the winner
      ERC20 token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than buyer
        ✔ Should transfer funds to the seller
        ✔ Should emit the CancelledByBuyer event
        With a dispute
          When only the seller paid
            ✔ Should return the dispute fee to the seller
          When only the buyer paid
            ✔ Should return the dispute fee to the buyer
          When both parts paid
            ✔ Should return the dispute fee to the winner
    Seller cancel
      Native token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than buyer
        ✔ Should not transfer funds if the seller cannot cancel
        ✔ Should transfer funds to the seller
        ✔ Should emit the CancelledBySeller event
      ERC20 token
        ✔ Should fail with a not found escrow
        ✔ Should revert with an address different than seller
        ✔ Should not transfer funds if the seller cannot cancel
        ✔ Should transfer funds to the seller
        ✔ Should emit the CancelledBySeller event
    Mark as paid
      Native token
        ✔ Should revert with an address different than buyer
        ✔ Should set sellerCanCancelAfter as 1
        ✔ Should emit the SellerCancelDisabled event
        ✔ Should fail with a not found escrow
    Open dispute
      ✔ Should fail with a not found escrow
      ✔ Should revert with an address different than seller or buyer
      As the seller
        ✔ Should revert if there is no dispute payment
        ✔ Should revert if there is not enough for the dispute payment
        ✔ Should revert with more than the dispute fee value
        ✔ Should revert if the user already paid
        ✔ Should mark the dispute as paid by the seller
        ✔ Should transfer 1 MATIC to the contract
        ✔ Should return true
        ✔ Should emit an DisputeOpened event
      As the buyer
        ✔ Should revert if there is no dispute payment
        ✔ Should revert if there is not enough for the dispute payment
        ✔ Should revert with more than the dispute fee value
        ✔ Should revert if the user already paid
        ✔ Should mark the dispute as paid by the buyer
        ✔ Should transfer 1 MATIC to the contract
        ✔ Should return true
        ✔ Should emit an DisputeOpened event
      Native token
        ✔ Should revert with if the buyer did not mark as paid
      ERC20 token
        ✔ Should revert with if the buyer did not mark as paid
    Resolve dispute
      ✔ Should revert with an address different than arbitrator
      ✔ Should revert if the dispute is not open
      ✔ Should revert with a wrong winner
      ✔ Should emit an DisputeResolved event
      ✔ Should fail with a not found escrow
      Valid resolutions
        Native token
          When only the seller paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer
          When only the buyer paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer
          When both parts paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer
        ERC20 token
          When only the seller paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer
          When only the buyer paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer
          When both parts paid
            With the seller as winner
              ✔ Should return the tokens to the seller
            With the buyer as winner
              ✔ Should return the tokens to the buyer

  OpenPeerEscrowsDeployer
    Deployment
      ✔ Should deploy successfully
      ✔ Should initialize the implementation
    Settings
      ✔ Should update the fee
      ✔ Should update the fee recipient
      ✔ Should update the arbitrator
      Validations
        ✔ Should revert with non owner tries to update the fee
        ✔ Should revert with non owner tries to update the fee recipient
        ✔ Should revert with non owner tries to update the arbitrator
        ✔ Should revert with non owner tries to update the trustedForwarder
        ✔ Should revert with non owner tries to update the implementation
        ✔ Should revert with non owner tries to update the feeDiscountNFT
        ✔ Should revert with non owner tries to toggle the contract active
    Fees
      With the fees discount NFT
        ✔ Should return fee with a 100% discount
      Without the fees discount NFT
        ✔ Should return fee without discounts
    Deploy
      ✔ Should emit a ContractCreated event
      ✔ Should be available in the seller contracts
      Multiple contracts per seller
        ✔ Should create a second contract for the same seller


  118 passing (7s)
```
