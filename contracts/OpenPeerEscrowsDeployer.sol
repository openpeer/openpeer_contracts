// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;
import "hardhat/console.sol";
import { OpenPeerEscrow } from "./OpenPeerEscrow.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract OpenPeerEscrowsDeployer is Ownable {
    mapping (address => bytes32) public escrows;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address public feeRecipient;
    uint8 public fee;

    /***********************
    +   Events            +
    ***********************/
    event EscrowCreated(address _escrow, bytes32 indexed _tradeHash);

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    constructor (address _arbitrator, address _feeRecipient, uint8 _fee) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        fee = _fee;
    }

    function deployNativeEscrow(address _buyer, uint256 _amount) external {
        deploy(_buyer, address(0), _amount);
    }

    function deployERC20Escrow(address _buyer, address _token,  uint256 _amount) external {
        deploy(_buyer, _token, _amount);
    }

    function deploy(address _buyer, address _token, uint256 _amount) private {
        OpenPeerEscrow escrow = new OpenPeerEscrow(_buyer, _token, _amount, fee, arbitrator, feeRecipient);

        bytes32 _tradeHash = keccak256(
            abi.encodePacked(address(escrow),
                             msg.sender,
                             _buyer,
                             _token,
                             _amount,
                             fee,
                             arbitrator,
                             feeRecipient)
        );
        escrows[address(escrow)] = _tradeHash;
        emit EscrowCreated(address(escrow), _tradeHash);
    }

    // setters

    /// @notice Updates the arbitrator
    /// @param _arbitrator Address of the arbitrator
    function setArbitrator(address _arbitrator) public onlyOwner {
        arbitrator = _arbitrator;
    }

    /// @notice Updates the fee recipient
    /// @param _feeRecipient Address of the arbitrator
    function setFeeRecipient(address _feeRecipient) public onlyOwner {
        feeRecipient = _feeRecipient;
    }

    /// @notice Updates the fee
    /// @param _fee fee amount (bps)
    function setFee(uint8 _fee) public onlyOwner {
        fee = _fee;
    }
}
