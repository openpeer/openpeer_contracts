// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/interfaces/IERC721.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { OpenPeerEscrow } from "./OpenPeerEscrow.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";
import { Ownable } from "./libs/Ownable.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrowsDeployer is ERC2771Context, Ownable {
    using SafeERC20 for IERC20;

    mapping (bytes32 => Escrow) public escrows;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address payable public feeRecipient;
    uint256 private _fee;
    uint32 public sellerWaitingTime;

    bool public stopped;

    address public implementation;

    // NFT contract for fee discounts
    address public feeDiscountNFT;

    /**********************
    +   Events            +
    ***********************/
    event EscrowCreated(bytes32 _tradeId, Escrow _escrow);

    struct Escrow {
        bool exists;
        address deployment;
    }

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param fee_ OP fee (bps) ex: 30 == 0.3%
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    /// @param _trustedForwarder Forwarder address
    /// @param _feeDiscountNFT Forwarder address
    constructor (
        address _arbitrator,
        address payable _feeRecipient,
        uint256 fee_,
        uint32 _sellerWaitingTime,
        address _trustedForwarder,
        address _feeDiscountNFT
    ) ERC2771Context(_trustedForwarder) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        _fee = fee_;
        sellerWaitingTime = _sellerWaitingTime;
        feeDiscountNFT = _feeDiscountNFT;
        implementation = address(new OpenPeerEscrow(_trustedForwarder));
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

    function deployNativeEscrow(bytes32 _orderID, address payable _buyer, uint256 _amount) external payable stopInEmergency {
        deploy(_orderID, _buyer, address(0), _amount);
    }

    function deployERC20Escrow(bytes32 _orderID, address payable _buyer, address _token,  uint256 _amount) external stopInEmergency {
        deploy(_orderID, _buyer, _token, _amount);
    }

    function deploy(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) private {
        bytes32 _orderHash = keccak256(abi.encodePacked(_orderID, _msgSender(), _buyer, _token, _amount));
        require(!escrows[_orderHash].exists, "Order already exists");

        uint256 userFee = fee();
        uint256 amount = (_amount * userFee / 10_000) + _amount;

        if (_token == address(0)) {
            require(msg.value == amount, "Incorrect MATIC sent");
        }

        address deployment = Clones.cloneDeterministic(implementation, _orderHash);
        OpenPeerEscrow(payable(deployment)).initialize(payable(_msgSender()),
                                                       _buyer,
                                                       _token,
                                                       _amount,
                                                       userFee,
                                                       arbitrator,
                                                       feeRecipient,
                                                       sellerWaitingTime);
        if (_token == address(0)) {
            (bool sent,) = deployment.call{value: amount}("");
            require(sent, "Failed to send MATIC");
        } else {
            uint256 balanceBefore = IERC20(_token).balanceOf(deployment);
            IERC20(_token).safeTransferFrom(_msgSender(), deployment, amount);
            uint256 balanceAfter = IERC20(_token).balanceOf(deployment);
            require((balanceAfter - balanceBefore) == amount, "Wrong ERC20 amount");
        }

        Escrow memory escrow = Escrow(true, deployment);
        escrows[_orderHash] = escrow;
        emit EscrowCreated(_orderHash, escrow);
    }

    /***********************
    +   Setters           +
    ***********************/

    /// @notice Updates the arbitrator
    /// @param _arbitrator Address of the arbitrator
    function setArbitrator(address _arbitrator) public onlyOwner {
        require(_arbitrator != address(0), "Invalid arbitrator");
        arbitrator = _arbitrator;
    }

    /// @notice Updates the fee recipient
    /// @param _feeRecipient Address of the arbitrator
    function setFeeRecipient(address payable _feeRecipient) public onlyOwner {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        feeRecipient = _feeRecipient;
    }

    /// @notice Updates the fee
    /// @param fee_ fee amount (bps)
    function setFee(uint256 fee_) public onlyOwner {
        require(fee_ <= 100);

        _fee = fee_;
    }

    /// @notice Updates the seller cancelation time
    /// @param _sellerWaitingTime Time in seconds
    function setSellerWaitingTime(uint32 _sellerWaitingTime) public onlyOwner {
        sellerWaitingTime = _sellerWaitingTime;
    }

    /// @notice Updates the forwarder
    /// @param trustedForwarder biconomy forwarder
    function setTrustedForwarder(address trustedForwarder) external onlyOwner {
        require(trustedForwarder != address(0), "Invalid trust forwarder");
        _trustedForwarder = trustedForwarder;
    }

    /// @notice Updates the implementation
    /// @param _implementation Address of the implementation
    function setImplementation(address payable _implementation) public onlyOwner {
        require(_implementation != address(0), "Invalid implementation");
        implementation = _implementation;
    }

    /// @notice Pauses and activate the contract
    function toggleContractActive() public onlyOwner {
        stopped = !stopped;
    }

    /// @notice Version recipient
    function versionRecipient() external pure returns (string memory) {
  		  return "1.0";
  	}

    /// @notice Updates the NFT contract for fee discounts
    function setFeeDiscountNFT(address _feeDiscountNFT) external onlyOwner {
        feeDiscountNFT = _feeDiscountNFT;
    }

    /***********************
    +   Getters           +
    ***********************/

    function fee() public view returns (uint256) {
        IERC721 discountNFT = IERC721(feeDiscountNFT);

        if (feeDiscountNFT != address(0) && discountNFT.balanceOf(_msgSender()) > 0) {
          return _fee / 2;
        }

        return _fee;
    }
}
