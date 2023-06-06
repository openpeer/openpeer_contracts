// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { IERC721 } from "@openzeppelin/contracts/interfaces/IERC721.sol";
import { OpenPeerEscrow } from "./OpenPeerEscrow.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";
import { Ownable } from "./libs/Ownable.sol";

contract OpenPeerEscrowsDeployer is ERC2771Context, Ownable {
    mapping (address => address) public sellerContracts;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address payable public feeRecipient;
    uint256 private fee;
    uint32 public sellerWaitingTime;

    bool public stopped;

    address public implementation;

    // NFT contract for fee discounts
    address public feeDiscountNFT;

    /**********************
    +   Events            +
    ***********************/
    event ContractCreated(address _seller, address _deployment);

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    /// @param _trustedForwarder Forwarder address
    /// @param _feeDiscountNFT NFT contract for fee discounts
    constructor (
        address _arbitrator,
        address payable _feeRecipient,
        uint256 _fee,
        uint32 _sellerWaitingTime,
        address _trustedForwarder,
        address _feeDiscountNFT
    ) ERC2771Context(_trustedForwarder) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        fee = _fee;
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

    function deploy() external returns (address) {
        address deployment = Clones.clone(implementation);
        OpenPeerEscrow(payable(deployment)).initialize(payable(_msgSender()),
                                                              fee,
                                                              arbitrator,
                                                              feeRecipient,
                                                              sellerWaitingTime,
                                                              _trustedForwarder,
                                                              feeDiscountNFT);
        sellerContracts[_msgSender()] = deployment;
        emit ContractCreated(_msgSender(), deployment);

        return deployment;
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
    /// @param _fee fee amount (bps)
    function setFee(uint256 _fee) public onlyOwner {
        require(_fee <= 100);

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

    function sellerFee() public view returns (uint256) {
        IERC721 discountNFT = IERC721(feeDiscountNFT);

        if (feeDiscountNFT != address(0) && discountNFT.balanceOf(_msgSender()) > 0) {
          return 0;
        }

        return fee;
    }
}
