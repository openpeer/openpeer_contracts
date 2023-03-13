// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrow is ERC2771Context, Initializable {
    address public arbitrator;
    address payable public feeRecipient;
    address payable public seller;
    address payable public buyer;
    address public token;
    uint256 public amount;
    uint256 public fee;
    uint32 public sellerWaitingTime;
    uint32 public sellerCanCancelAfter;
    bool public dispute;
    uint256 public immutable disputeFee = 1 ether;

    mapping (address => bool) public paidForDispute;

    /// @param _trustedForwarder Forwarder address
    constructor(address _trustedForwarder) ERC2771Context(_trustedForwarder) {
      _disableInitializers();
    }

    /// @param _seller Seller address
    /// @param _buyer Buyer address
    /// @param _token Token address or 0x0000000000000000000000000000000000000000 for native token
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    function initialize(
        address payable _seller,
        address payable _buyer,
        address _token,
        uint256 _amount,
        uint256 _fee,
        address _arbitrator,
        address payable _feeRecipient,
        uint32 _sellerWaitingTime
    ) external virtual initializer {
        require(_amount > 0, "Invalid amount");
        require(_buyer != _seller, "Seller and buyer must be different");
        require(_seller != address(0), "Invalid seller");
        require(_buyer != address(0), "Invalid buyer");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_arbitrator != address(0), "Invalid arbitrator");

        seller = _seller;
        token = _token;
        buyer = _buyer;
        amount = _amount;
        fee = (amount * _fee / 10_000);
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        sellerWaitingTime = _sellerWaitingTime;
        sellerCanCancelAfter = uint32(block.timestamp) + sellerWaitingTime;
    }

    // Events
    event Released();
    event CancelledByBuyer();
    event SellerCancelDisabled();
    event CancelledBySeller();
    event DisputeOpened(address _sender);
    event DisputeResolved();

    modifier onlySeller() {
        require(_msgSender() == seller, "Must be seller");
        _;
    }

    modifier onlyArbitrator() {
        require(_msgSender() == arbitrator, "Must be arbitrator");
        _;
    }

    modifier onlyBuyer() {
        require(_msgSender() == buyer, "Must be buyer");
        _;
    }

    /// @notice Release ether or token in escrow to the buyer.
    /// @return bool
    function release() external onlySeller returns (bool) {
        transferEscrowAndFees(buyer, amount, fee, false);
        emit Released();
        return true;
    }

    /// @notice Transfer the value of an escrow
    /// @param _to Recipient address
    /// @param _amount Amount to be transfered
    /// @param _fee Fee to be transfered
    /// @param _disputeResolution Is a dispute being resolved
    function transferEscrowAndFees(
        address payable _to,
        uint256 _amount,
        uint256 _fee,
        bool _disputeResolution
    ) private {
        // transfers the amount to the seller | buyer
        withdraw(_to, _amount);
        if (_fee > 0) {
            // transfers the fee to the fee recipient
            withdraw(feeRecipient, _fee);
        }

        if (_disputeResolution) {
            (bool sentToWinner,) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to the winner");

            if (paidForDispute[seller] && paidForDispute[buyer]) {
                (bool sent,) = feeRecipient.call{value: disputeFee}("");
                require(sent, "Failed to send the fee MATIC to the fee recipient");
            }
        } else if (paidForDispute[seller] && !paidForDispute[buyer]) {
            // only the seller paid for the dispute, returns the fee to the seller
            (bool sent,) = seller.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the seller");
        } else if (paidForDispute[buyer] && !paidForDispute[seller]) {
            // only the buyer paid for the dispute, returns the fee to the buyer
            (bool sent,) = buyer.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the buyer");
        } else if (paidForDispute[buyer] && paidForDispute[seller]) {
            // seller and buyer paid for the dispute, split the fee between the winner and the fee recipient
            (bool sentToWinner,) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to winner");

            (bool sent,) = feeRecipient.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the fee recipient");
        }
    }

    /// @notice Cancel the escrow as a buyer with 0 fees
    /// @return bool
    function buyerCancel() external onlyBuyer returns (bool) {
        transferEscrowAndFees(seller, amount + fee, 0, false);
        emit CancelledByBuyer();
        return true;
    }

    /// @notice Cancel the escrow as a seller
    /// @return bool
    function sellerCancel() external onlySeller returns (bool) {
        if (sellerCanCancelAfter <= 1 || sellerCanCancelAfter > block.timestamp) {
            return false;
        }

        transferEscrowAndFees(seller, amount + fee, 0, false);
        emit CancelledBySeller();
        return true;
    }

    /// @notice Disable the seller from cancelling
    /// @return bool
    function markAsPaid() external onlyBuyer returns (bool) {
        sellerCanCancelAfter = 1;
        emit SellerCancelDisabled();
        return true;
    }

    /// @notice Withdraw values in the contract
    /// @param _to Address to withdraw fees in to
    /// @param _amount Amount to withdraw
    function withdraw(address payable _to, uint256 _amount) private  {
        if (token == address(0)) {
            (bool sent,) = _to.call{value: _amount}("");
            require(sent, "Failed to send MATIC");
        } else {
            require(IERC20(token).transfer(_to, _amount), "Failed to send tokens");
        }
    }

    /// @notice Allow seller or buyer to open a dispute
    function openDispute() external payable {
        require(_msgSender() == seller || _msgSender() == buyer, "Must be seller or buyer");
        require(sellerCanCancelAfter == 1, "Cannot open a dispute yet");
        require(msg.value == disputeFee, "To open a dispute, you must pay 1 MATIC");
        require(!paidForDispute[_msgSender()], "This address already paid for the dispute");

        if (token == address(0)) {
            require(address(this).balance - msg.value > 0, "No funds to dispute");
        } else {
            require(IERC20(token).balanceOf(address(this)) > 0, "No funds to dispute");
        }

        dispute = true;
        paidForDispute[_msgSender()] = true;
        emit DisputeOpened(_msgSender());
    }

    /// @notice Allow arbitrator to resolve a dispute
    /// @param _winner Address to receive the escrowed values - fees
    function resolveDispute(address payable _winner) external onlyArbitrator {
        require(dispute, "Dispute is not open");
        require(_winner == seller || _winner == buyer, "Winner must be seller or buyer");

        emit DisputeResolved();
        transferEscrowAndFees(_winner, amount, fee, true);
    }

    /// @notice Version recipient
    function versionRecipient() external pure returns (string memory) {
        return "1.0";
  	}

    receive() external payable {}
}