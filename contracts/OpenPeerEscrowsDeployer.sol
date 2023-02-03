// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { OpenPeerEscrow } from "./OpenPeerEscrow.sol";
import { Ownable } from "./libs/Ownable.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrowsDeployer is ERC2771Context, Ownable {
    mapping (bytes32 => Escrow) public escrows;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address payable public feeRecipient;
    uint8 public fee;
    uint32 public sellerWaitingTime;

    bool public stopped = false;

    /**********************
    +   Events            +
    ***********************/
    event EscrowCreated(bytes32 _orderID, Escrow _escrow);

    struct Escrow {
        bool exists;
        address deployment;
        address seller;
        address buyer;
        address token;
        uint256 amount;
    }

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    /// @param _trustedForwarder Forwarder address
    constructor (
        address _arbitrator,
        address payable _feeRecipient,
        uint8 _fee,
        uint32 _sellerWaitingTime,
        address _trustedForwarder
    ) ERC2771Context(_trustedForwarder) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        fee = _fee;
        sellerWaitingTime = _sellerWaitingTime;
    }

    /***********************
    +   Modifiers          +
    ***********************/

    // circuit breaker modifiers
    modifier stopInEmergency {
        if (stopped) {
            revert("Paused");
        } else {
            _;
        }
    }

    function deployNativeEscrow(bytes32 _orderID, address payable _buyer, uint256 _amount) external stopInEmergency {
        deploy(_orderID, _buyer, address(0), _amount);
    }

    function deployERC20Escrow(bytes32 _orderID, address payable _buyer, address _token,  uint256 _amount) external stopInEmergency {
        deploy(_orderID, _buyer, _token, _amount);
    }

    function deploy(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) private {
        require(!escrows[_orderID].exists, "Order already exists");

        OpenPeerEscrow deployment = new OpenPeerEscrow(payable(_msgSender()),
                                                       _buyer,
                                                       _token,
                                                       _amount,
                                                       fee,
                                                       arbitrator,
                                                       feeRecipient,
                                                       sellerWaitingTime,
                                                       _trustedForwarder);
                                                   
        Escrow memory escrow = Escrow(true, address(deployment), _msgSender(), _buyer, _token, _amount);
        escrows[_orderID] = escrow;
        emit EscrowCreated(_orderID, escrow);
    }

    /***********************
    +   Setters           +
    ***********************/

    /// @notice Updates the arbitrator
    /// @param _arbitrator Address of the arbitrator
    function setArbitrator(address _arbitrator) public onlyOwner {
        arbitrator = _arbitrator;
    }

    /// @notice Updates the fee recipient
    /// @param _feeRecipient Address of the arbitrator
    function setFeeRecipient(address payable _feeRecipient) public onlyOwner {
        feeRecipient = _feeRecipient;
    }

    /// @notice Updates the fee
    /// @param _fee fee amount (bps)
    function setFee(uint8 _fee) public onlyOwner {
        fee = _fee;
    }

    /// @notice Updates the seller cancelation time
    /// @param _sellerWaitingTime Time in seconds
    function setSellerWaitingTime(uint32 _sellerWaitingTime) public onlyOwner {
        sellerWaitingTime = _sellerWaitingTime;
    }

    /// @notice Updates the forwarder
    /// @param trustedForwarder biconomy forwarder
    function setTrustedForwarder(address trustedForwarder) external onlyOwner {
        _trustedForwarder = trustedForwarder;
    }

    /// @notice Pauses and activate the contract
    function toggleContractActive() public onlyOwner {
        stopped = !stopped;
    }

    /// @notice Version recipient
    function versionRecipient() external pure returns (string memory) {
  		  return "1.0";
  	}
}
