// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrow is ERC2771Context {
    address public arbitrator;
    address payable public feeRecipient;
    address payable public immutable seller;
    address payable public immutable buyer;
    address public immutable token;
    uint256 public immutable amount;
    uint256 public immutable fee;
    uint32 public immutable sellerWaitingTime;
    uint32 public sellerCanCancelAfter;

    bool public dispute;

    /// @notice Settings
    /// @param _seller Seller address
    /// @param _buyer Buyer address
    /// @param _token Token address or 0x0000000000000000000000000000000000000000 for native token
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    /// @param _trustedForwarder Forwarder address
    constructor(
        address payable _seller,
        address payable _buyer,
        address _token,
        uint256 _amount,
        uint256 _fee,
        address _arbitrator,
        address payable _feeRecipient,
        uint32 _sellerWaitingTime,
        address _trustedForwarder
    ) ERC2771Context(_trustedForwarder) {
        require(_amount > 0, "Invalid amount");
        require(_buyer != _seller, "Seller and buyer must be different");
        require(_seller != address(0), "Invalid seller");
        require(_buyer != address(0), "Invalid buyer");

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
    event DisputeOpened();
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
        transferEscrowAndFees(buyer, amount, fee);
        emit Released();
        return true;
    }

    /// @notice Transfer the value of an escrow
    /// @param _to Recipient address
    /// @param _amount Amount to be transfered
    /// @param _fee Fee to be transfered
    function transferEscrowAndFees(address payable _to, uint256 _amount, uint256 _fee) private {
        withdraw(_to, _amount);
        if (_fee > 0) {
            withdraw(feeRecipient, _fee);
        }
    }

    /// @notice Cancel the escrow as a buyer with 0 fees
    /// @return bool
    function buyerCancel() external onlyBuyer returns (bool) {
        transferEscrowAndFees(seller, amount + fee, 0);
        emit CancelledByBuyer();
        return true;
    }

    /// @notice Cancel the escrow as a seller
    /// @return bool
    function sellerCancel() external onlySeller returns (bool) {
        if (sellerCanCancelAfter <= 1 || sellerCanCancelAfter > block.timestamp) {
            return false;
        }

        transferEscrowAndFees(seller, amount + fee, 0);
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
    function openDispute() external {
        require(_msgSender() == seller || _msgSender() == buyer, "Must be seller or buyer");

        if (token == address(0)) {
            require(address(this).balance > 0, "No funds to dispute");
        } else {
            require(IERC20(token).balanceOf(address(this)) > 0, "No funds to dispute");
        }

        dispute = true;
        emit DisputeOpened();
    }

    /// @notice Allow arbitrator to resolve a dispute
    /// @param _winner Address to receive the escrowed values - fees
    function resolveDispute(address payable _winner) external onlyArbitrator {
        require(dispute, "Dispute is not open");
        require(_winner == seller || _winner == buyer, "Winner must be seller or buyer");

        emit DisputeResolved();
        transferEscrowAndFees(_winner, amount, fee);
    }

    /// @notice Version recipient
    function versionRecipient() external pure returns (string memory) {
        return "1.0";
  	}

    receive() external payable {}
}