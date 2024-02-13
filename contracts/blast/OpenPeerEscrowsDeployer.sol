// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC721} from "@openzeppelin/contracts/interfaces/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OpenPeerEscrow} from "./OpenPeerEscrow.sol";
import {IBlast} from "../interfaces/IBlast.sol";
import {IERC20Rebasing} from "../interfaces/IERC20Rebasing.sol";

contract OpenPeerEscrowsDeployer is Ownable {
    mapping(address => address) public sellerContracts;
    mapping(address => uint256) public partnerFeeBps;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address payable public feeRecipient;
    uint256 private fee;
    uint256 public disputeFee;

    bool public stopped;

    address public implementation;

    // NFT contract for fee discounts
    address public feeDiscountNFT;

    /**********************
    +   Blast Yield       +
    ***********************/
    IBlast public constant BLAST =
        IBlast(0x4300000000000000000000000000000000000002);
    IERC20Rebasing public constant USDB =
        IERC20Rebasing(0x4200000000000000000000000000000000000022);
    IERC20Rebasing public constant WETH =
        IERC20Rebasing(0x4200000000000000000000000000000000000023);

    /**********************
    +   Events            +
    ***********************/
    event ContractCreated(address _seller, address _deployment);

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _feeDiscountNFT NFT contract for fee discounts
    /// @param _disputeFee Dispute fee
    constructor(
        address _arbitrator,
        address payable _feeRecipient,
        uint256 _fee,
        address _feeDiscountNFT,
        uint256 _disputeFee
    ) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        fee = _fee;
        feeDiscountNFT = _feeDiscountNFT;
        disputeFee = _disputeFee;
        implementation = address(new OpenPeerEscrow());
    }

    /***********************
    +   Modifiers          +
    ***********************/

    // circuit breaker modifiers
    modifier stopInEmergency() {
        if (stopped) {
            revert("Paused");
        } else {
            _;
        }
    }

    function deploy() external returns (address) {
        address deployment = Clones.clone(implementation);
        OpenPeerEscrow(payable(deployment)).initialize(
            payable(_msgSender()),
            fee,
            arbitrator,
            feeRecipient,
            feeDiscountNFT,
            disputeFee
        );
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

    /// @notice Updates the implementation
    /// @param _implementation Address of the implementation
    function setImplementation(
        address payable _implementation
    ) public onlyOwner {
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

    function updatePartnerFeeBps(
        address[] calldata _partners,
        uint256[] calldata _fees
    ) external onlyOwner {
        require(_partners.length == _fees.length, "Invalid input");

        for (uint256 i = 0; i < _partners.length; i++) {
            require(_fees[i] <= 100, "Invalid fee bps");
            require(_partners[i] != address(0), "Invalid partner address");

            partnerFeeBps[_partners[i]] = _fees[i];
        }
    }

    function claimYield(
        address[] calldata _contracts,
        address recipient
    ) external onlyOwner {
        for (uint256 i = 0; i < _contracts.length; i++) {
            address contractAddress = _contracts[i];
            BLAST.claimAllYield(contractAddress, recipient);
            USDB.claim(
                contractAddress,
                USDB.getClaimableAmount(contractAddress)
            );
            WETH.claim(
                contractAddress,
                WETH.getClaimableAmount(contractAddress)
            );
            BLAST.claimMaxGas(contractAddress, recipient);
        }
    }

    /***********************
    +   Getters           +
    ***********************/

    function openPeerFee() public view returns (uint256) {
        IERC721 discountNFT = IERC721(feeDiscountNFT);

        if (
            feeDiscountNFT != address(0) &&
            discountNFT.balanceOf(_msgSender()) > 0
        ) {
            return 0;
        }

        return fee;
    }

    function sellerFee(address _partner) public view returns (uint256) {
        return openPeerFee() + partnerFeeBps[_partner];
    }
}
