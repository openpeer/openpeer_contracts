// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { OpenPeerEscrow } from "./OpenPeerEscrow.sol";
import { Ownable } from "./libs/Ownable.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrowsDeployer is ERC2771Context, Ownable {
    mapping (address => bytes32) public escrows;

    /***********************
    +   Global settings   +
    ***********************/
    address public arbitrator;
    address public feeRecipient;
    uint8 public fee;

    bool public stopped = false;

    /***********************
    +   Events            +
    ***********************/
    event EscrowCreated(address indexed _escrow, bytes32 indexed _tradeHash);

    /// @notice Settings
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _fee OP fee (bps) ex: 30 == 0.3%
    /// @param _trustedForwarder Forwarder address
    constructor (
        address _arbitrator,
        address _feeRecipient,
        uint8 _fee,
        address _trustedForwarder
    ) ERC2771Context(_trustedForwarder) {
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        fee = _fee;
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

    function deployNativeEscrow(address _buyer, uint256 _amount) external stopInEmergency {
        deploy(_buyer, address(0), _amount);
    }

    function deployERC20Escrow(address _buyer, address _token,  uint256 _amount) external stopInEmergency {
        deploy(_buyer, _token, _amount);
    }

    function deploy(address _buyer, address _token, uint256 _amount) private {
        OpenPeerEscrow escrow = new OpenPeerEscrow(_buyer,
                                                   _token,
                                                   _amount,
                                                   fee,
                                                   arbitrator,
                                                   feeRecipient,
                                                   _trustedForwarder);

        bytes32 _tradeHash = keccak256(
            abi.encodePacked(address(escrow),
                             _msgSender(),
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
    function setFeeRecipient(address _feeRecipient) public onlyOwner {
        feeRecipient = _feeRecipient;
    }

    /// @notice Updates the fee
    /// @param _fee fee amount (bps)
    function setFee(uint8 _fee) public onlyOwner {
        fee = _fee;
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
