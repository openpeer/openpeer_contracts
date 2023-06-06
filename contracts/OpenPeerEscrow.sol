// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { IERC721 } from "@openzeppelin/contracts/interfaces/IERC721.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ERC2771Context } from "./libs/ERC2771Context.sol";

contract OpenPeerEscrow is ERC2771Context, Initializable {
    using SafeERC20 for IERC20;
    mapping (bytes32 => Escrow) public escrows;

    address payable public seller;
    address public arbitrator;
    address payable public feeRecipient;
    uint32 public sellerWaitingTime;
    address public feeDiscountNFT;
    uint256 public feeBps;
    uint256 public immutable disputeFee = 1 ether;
    mapping(bytes32 => mapping(address => bool)) public disputePayments;

    /**********************
    +   Events            +
    ***********************/
    event EscrowCreated(bytes32 indexed _orderHash);
    event Released(bytes32 indexed _orderHash);
    event CancelledByBuyer(bytes32 indexed _orderHash);
    event SellerCancelDisabled(bytes32 indexed _orderHash);
    event CancelledBySeller(bytes32 indexed _orderHash);
    event DisputeOpened(bytes32 indexed _orderHash, address indexed _sender);
    event DisputeResolved(bytes32 indexed _orderHash, address indexed _winner);

    struct Escrow {
        // So we know the escrow exists
        bool exists;
        // This is the timestamp in whic hthe seller can cancel the escrow after.
        // It has a special value:
        // 1 : Permanently locked by the buyer (i.e. marked as paid; the seller can never cancel)
        uint32 sellerCanCancelAfter;
        uint256 fee;
        bool dispute;
    }

    /// @param _trustedForwarder Forwarder address
    constructor(address _trustedForwarder) ERC2771Context(_trustedForwarder) {
        _disableInitializers();
    }

    /// @param _seller Seller address
    /// @param _feeBps OP fee (bps) ex: 30 == 0.3%
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param _sellerWaitingTime Number of seconds where the seller can cancel the order if the buyer did not pay
    /// @param trustedForwarder Forwarder address
    function initialize(
        address payable _seller,
        uint256 _feeBps,
        address _arbitrator,
        address payable _feeRecipient,
        uint32 _sellerWaitingTime,
        address trustedForwarder,
        address _feeDiscountNFT
    ) external virtual initializer {
        require(_seller != address(0), "Invalid seller");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_arbitrator != address(0), "Invalid arbitrator");
        require(trustedForwarder != address(0), "Invalid trust forwarder");

        seller = _seller;
        feeBps = _feeBps;
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        sellerWaitingTime = _sellerWaitingTime;
        _trustedForwarder = trustedForwarder;
        feeDiscountNFT = _feeDiscountNFT;
    }

    // Modifiers
    modifier onlySeller() {
        require(_msgSender() == seller, "Must be seller");
        _;
    }

    modifier onlyArbitrator() {
        require(_msgSender() == arbitrator, "Must be arbitrator");
        _;
    }

    // Errors
    error EscrowNotFound();

    function createNativeEscrow(bytes32 _orderID, address payable _buyer, uint256 _amount) external payable {
        create(_orderID, _buyer, address(0), _amount);
    }

    function createERC20Escrow(bytes32 _orderID, address payable _buyer, address _token,  uint256 _amount) external {
        create(_orderID, _buyer, _token, _amount);
    }

    function create(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) private {
        require(_amount > 0, "Invalid amount");
        require(_buyer != address(0), "Invalid buyer");
        require(_buyer != seller, "Seller and buyer must be different");

        bytes32 _orderHash = keccak256(abi.encodePacked(_orderID, seller, _buyer, _token, _amount));
        require(!escrows[_orderHash].exists, "Order already exists");

        uint256 orderFee = (_amount * sellerFee() / 10_000);
        uint256 amount = orderFee + _amount;

        if (_token == address(0)) {
            require(msg.value == amount, "Incorrect MATIC sent");
        } else {
            uint256 balanceBefore = IERC20(_token).balanceOf(address(this));
            IERC20(_token).safeTransferFrom(_msgSender(), address(this), amount);
            uint256 balanceAfter = IERC20(_token).balanceOf(address(this));
            require((balanceAfter - balanceBefore) == amount, "Wrong ERC20 amount");
        }

        Escrow memory escrow = Escrow(true, uint32(block.timestamp) + sellerWaitingTime, orderFee, false);
        escrows[_orderHash] = escrow;
        emit EscrowCreated(_orderHash);
    }

    /// @notice Disable the seller from cancelling
    /// @return bool
    function markAsPaid(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) external returns (bool) {
        require(_msgSender() == _buyer, "Must be buyer");

        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }
        if(_escrow.sellerCanCancelAfter == 1) return false;

        escrows[_orderHash].sellerCanCancelAfter = 1;
        emit SellerCancelDisabled(_orderHash);
        return true;
    }

    /// @notice Release ether or token in escrow to the buyer.
    /// @return bool
    function release(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) external onlySeller returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }

        transferEscrowAndFees(_orderHash, _buyer, _token, _buyer, _amount, _escrow.fee, false);
        emit Released(_orderHash);
        return true;
    }

    /// @notice Cancel the escrow as a buyer with 0 fees
    /// @return bool
    function buyerCancel(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) external returns (bool) {
        require(_msgSender() == _buyer, "Must be buyer");

        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }

        transferEscrowAndFees(_orderHash, _buyer, _token, seller, _amount + _escrow.fee, 0, false);
        emit CancelledByBuyer(_orderHash);
        return true;
    }

    /// @notice Cancel the escrow as a seller
    /// @return bool
    function sellerCancel(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) external onlySeller returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }

        if (_escrow.sellerCanCancelAfter <= 1 || _escrow.sellerCanCancelAfter > block.timestamp) {
            return false;
        }

        transferEscrowAndFees(_orderHash, _buyer, _token, seller, _amount + _escrow.fee, 0, false);
        emit CancelledBySeller(_orderHash);
        return true;
    }

    /// @notice Allow seller or buyer to open a dispute
    function openDispute(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount) external payable returns (bool) {
        require(_msgSender() == seller || _msgSender() == _buyer, "Must be seller or buyer");
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }

        require(_escrow.sellerCanCancelAfter == 1, "Cannot open a dispute yet");
        require(msg.value == disputeFee, "To open a dispute, you must pay 1 MATIC");
        require(!disputePayments[_orderHash][_msgSender()], "This address already paid for the dispute");

        escrows[_orderHash].dispute = true;
        disputePayments[_orderHash][_msgSender()] = true;
        emit DisputeOpened(_orderHash, _msgSender());
        return true;
    }

    /// @notice Allow arbitrator to resolve a dispute
    /// @param _winner Address to receive the escrowed values - fees
    function resolveDispute(bytes32 _orderID, address payable _buyer, address _token, uint256 _amount, address payable _winner) external onlyArbitrator returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(_orderID, _buyer, _token, _amount);
        if (!_escrow.exists) {
          revert EscrowNotFound();
        }

        require(_escrow.dispute, "Dispute is not open");
        require(_winner == seller || _winner == _buyer, "Winner must be seller or buyer");

        emit DisputeResolved(_orderHash, _winner);
        transferEscrowAndFees(_orderHash, _buyer, _token, _winner, _amount, _escrow.fee, true);
        return true;
    }

    /// @notice Transfer the value of an escrow
    /// @param _to Recipient address
    /// @param _amount Amount to be transfered
    /// @param _fee Fee to be transfered
    /// @param _disputeResolution Is a dispute being resolved?
    function transferEscrowAndFees(
        bytes32 _orderHash,
        address payable _buyer,
        address _token,
        address payable _to,
        uint256 _amount,
        uint256 _fee,
        bool _disputeResolution
    ) private {
        delete escrows[_orderHash];
        // transfers the amount to the seller | buyer
        withdraw(_token, _to, _amount);
        if (_fee > 0) {
            // transfers the fee to the fee recipient
            withdraw(_token, feeRecipient, _fee);
        }

        bool sellerPaid = disputePayments[_orderHash][seller];
        bool buyerPaid = disputePayments[_orderHash][_buyer];
        delete disputePayments[_orderHash][seller];
        delete disputePayments[_orderHash][_buyer];

        if (_disputeResolution) {
            (bool sentToWinner,) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to the winner");

            if (sellerPaid && buyerPaid) {
                (bool sent,) = feeRecipient.call{value: disputeFee}("");
                require(sent, "Failed to send the fee MATIC to the fee recipient");
            }
        } else if (sellerPaid && !buyerPaid) {
            // only the seller paid for the dispute, returns the fee to the seller
            (bool sent,) = seller.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the seller");
        } else if (buyerPaid && !sellerPaid) {
            // only the buyer paid for the dispute, returns the fee to the buyer
            (bool sent,) = _buyer.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the buyer");
        } else if (buyerPaid && sellerPaid) {
            // seller and buyer paid for the dispute, split the fee between the winner and the fee recipient
            (bool sentToWinner,) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to winner");

            (bool sent,) = feeRecipient.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the fee recipient");
        }
    }

    /// @notice Withdraw values in the contract
    /// @param _token Address of the token to withdraw fees in to
    /// @param _to Address to withdraw fees in to
    /// @param _amount Amount to withdraw
    function withdraw(address _token, address payable _to, uint256 _amount) private  {
        if (_token == address(0)) {
            (bool sent,) = _to.call{value: _amount}("");
            require(sent, "Failed to send MATIC");
        } else {
            require(IERC20(_token).transfer(_to, _amount), "Failed to send tokens");
        }
    }

    /// @notice Version recipient
    function versionRecipient() external pure returns (string memory) {
        return "1.0";
  	}

    /// @notice Hashes the values and returns the matching escrow object and trade hash.
    /// @dev Returns an empty escrow struct and 0 _orderHash if not found.
    /// @param _orderID Escrow "_orderID" parameter
    /// @param _buyer Escrow "buyer" parameter
    /// @param _token Escrow "token" parameter
    /// @param _amount Escrow "amount" parameter
    /// @return Escrow
    function getEscrowAndHash(
        bytes32 _orderID,
        address _buyer,
        address _token,
        uint256 _amount
    ) view private returns (Escrow memory, bytes32) {
        bytes32 _orderHash = keccak256(abi.encodePacked(
            _orderID,
            seller,
            _buyer,
            _token,
            _amount
        ));
        return (escrows[_orderHash], _orderHash);
    }


    /***********************
    +   Getters           +
    ***********************/

    function sellerFee() public view returns (uint256) {
        IERC721 discountNFT = IERC721(feeDiscountNFT);

        if (feeDiscountNFT != address(0) && discountNFT.balanceOf(_msgSender()) > 0) {
          return 0;
        }

        return feeBps;
    }
}