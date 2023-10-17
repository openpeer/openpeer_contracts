// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC721} from "@openzeppelin/contracts/interfaces/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC2771Context} from "./libs/ERC2771Context.sol";
import {IOpenPeerDeployer} from "./interfaces/IOpenPeerDeployer.sol";

contract OpenPeerEscrow is ERC2771Context, Initializable {
    using SafeERC20 for IERC20;
    mapping(bytes32 => Escrow) public escrows;

    address payable public seller;
    address public deployer;
    address public arbitrator;
    address payable public feeRecipient;
    address public feeDiscountNFT;
    uint256 public feeBps;
    uint256 public disputeFee;
    mapping(bytes32 => mapping(address => bool)) public disputePayments;
    mapping(address => uint256) public balancesInUse;

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
        // This is the timestamp in which the seller can cancel the escrow after.
        // It has a special value:
        // 1 : Permanently locked by the buyer (i.e. marked as paid; the seller can never cancel)
        uint32 sellerCanCancelAfter;
        uint256 fee;
        bool dispute;
        address payable partner;
        uint256 openPeerFee;
        bool automaticEscrow;
    }

    /// @param _trustedForwarder Forwarder address
    constructor(address _trustedForwarder) ERC2771Context(_trustedForwarder) {
        _disableInitializers();
    }

    /// @param _seller Seller address
    /// @param _feeBps OP fee (bps) ex: 30 == 0.3%
    /// @param _arbitrator Address of the arbitrator (currently OP staff)
    /// @param _feeRecipient Address to receive the fees
    /// @param trustedForwarder Forwarder address
    /// @param _feeDiscountNFT NFT contract for fee discounts
    /// @param _disputeFee Fee to open a dispute
    function initialize(
        address payable _seller,
        uint256 _feeBps,
        address _arbitrator,
        address payable _feeRecipient,
        address trustedForwarder,
        address _feeDiscountNFT,
        uint256 _disputeFee
    ) external virtual initializer {
        require(_seller != address(0), "Invalid seller");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_arbitrator != address(0), "Invalid arbitrator");
        require(trustedForwarder != address(0), "Invalid trust forwarder");

        seller = _seller;
        feeBps = _feeBps;
        arbitrator = _arbitrator;
        feeRecipient = _feeRecipient;
        _trustedForwarder = trustedForwarder;
        feeDiscountNFT = _feeDiscountNFT;
        disputeFee = _disputeFee;
        deployer = _msgSender();
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

    function createNativeEscrow(
        bytes32 _orderID,
        address payable _buyer,
        uint256 _amount,
        address payable _partner,
        uint32 _sellerWaitingTime,
        bool _automaticEscrow
    ) external payable {
        create(
            _orderID,
            _buyer,
            address(0),
            _amount,
            _partner,
            _sellerWaitingTime,
            _automaticEscrow
        );
    }

    function createERC20Escrow(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount,
        address payable _partner,
        uint32 _sellerWaitingTime,
        bool _automaticEscrow
    ) external {
        create(
            _orderID,
            _buyer,
            _token,
            _amount,
            _partner,
            _sellerWaitingTime,
            _automaticEscrow
        );
    }

    function create(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount,
        address payable _partner,
        uint32 _sellerWaitingTime,
        bool _automaticEscrow
    ) private {
        require(_amount > 0, "Invalid amount");
        require(_buyer != address(0), "Invalid buyer");
        require(_buyer != seller, "Seller and buyer must be different");
        require(
            _sellerWaitingTime >= 15 minutes && _sellerWaitingTime <= 1 days,
            "Invalid seller waiting time"
        );
        if (_automaticEscrow) {
            require(msg.value == 0, "Cannot send tokens with automatic escrow");
        }

        bytes32 _orderHash = keccak256(
            abi.encodePacked(_orderID, seller, _buyer, _token, _amount)
        );
        require(!escrows[_orderHash].exists, "Order already exists");

        uint256 opFee = ((_amount * openPeerFee()) / 10_000);
        uint256 orderFee = ((_amount * sellerFee(_partner)) / 10_000);
        uint256 amount = orderFee + _amount;

        validateAndPullTokens(_token, amount, _automaticEscrow);

        Escrow memory escrow = Escrow(
            true,
            uint32(block.timestamp) + _sellerWaitingTime,
            orderFee,
            false,
            _partner,
            opFee,
            _automaticEscrow
        );
        escrows[_orderHash] = escrow;
        emit EscrowCreated(_orderHash);
    }

    function validateAndPullTokens(
        address _token,
        uint256 _amount,
        bool _automaticEscrow
    ) internal {
        if (_automaticEscrow) {
            require(balances(_token) >= _amount, "Not enough tokens in escrow");
            balancesInUse[_token] += _amount;
        } else {
            if (_token == address(0)) {
                require(msg.value == _amount, "Incorrect amount sent");
            } else {
                uint256 balanceBefore = IERC20(_token).balanceOf(address(this));
                IERC20(_token).safeTransferFrom(
                    _msgSender(),
                    address(this),
                    _amount
                );
                uint256 balanceAfter = IERC20(_token).balanceOf(address(this));
                require(
                    (balanceAfter - balanceBefore) == _amount,
                    "Wrong ERC20 amount"
                );
            }
        }
    }

    /// @notice Disable the seller from cancelling
    /// @return bool
    function markAsPaid(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount
    ) external returns (bool) {
        require(_msgSender() == _buyer, "Must be buyer");

        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }
        if (_escrow.sellerCanCancelAfter == 1) return false;

        escrows[_orderHash].sellerCanCancelAfter = 1;
        emit SellerCancelDisabled(_orderHash);
        return true;
    }

    /// @notice Release ether or token in escrow to the buyer.
    /// @return bool
    function release(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount
    ) external onlySeller returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }

        transferEscrowAndFees(
            _orderHash,
            _buyer,
            _token,
            _buyer,
            _amount,
            _escrow.fee,
            _escrow.partner,
            _escrow.openPeerFee,
            false,
            _escrow.automaticEscrow
        );
        emit Released(_orderHash);
        return true;
    }

    /// @notice Cancel the escrow as a buyer with 0 fees
    /// @return bool
    function buyerCancel(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount
    ) external returns (bool) {
        require(_msgSender() == _buyer, "Must be buyer");

        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }

        transferEscrowAndFees(
            _orderHash,
            _buyer,
            _token,
            seller,
            _amount + _escrow.fee,
            0,
            _escrow.partner,
            0,
            false,
            _escrow.automaticEscrow
        );
        emit CancelledByBuyer(_orderHash);
        return true;
    }

    /// @notice Cancel the escrow as a seller
    /// @return bool
    function sellerCancel(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount
    ) external onlySeller returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }

        if (
            _escrow.sellerCanCancelAfter <= 1 ||
            _escrow.sellerCanCancelAfter > block.timestamp
        ) {
            return false;
        }

        transferEscrowAndFees(
            _orderHash,
            _buyer,
            _token,
            seller,
            _amount + _escrow.fee,
            0,
            _escrow.partner,
            0,
            false,
            _escrow.automaticEscrow
        );
        emit CancelledBySeller(_orderHash);
        return true;
    }

    /// @notice Allow seller or buyer to open a dispute
    function openDispute(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount
    ) external payable returns (bool) {
        require(
            _msgSender() == seller || _msgSender() == _buyer,
            "Must be seller or buyer"
        );
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }

        require(_escrow.sellerCanCancelAfter == 1, "Cannot open a dispute yet");
        require(
            msg.value == disputeFee,
            "To open a dispute, you must pay 1 MATIC"
        );
        require(
            !disputePayments[_orderHash][_msgSender()],
            "This address already paid for the dispute"
        );

        escrows[_orderHash].dispute = true;
        disputePayments[_orderHash][_msgSender()] = true;
        emit DisputeOpened(_orderHash, _msgSender());
        return true;
    }

    /// @notice Allow arbitrator to resolve a dispute
    /// @param _winner Address to receive the escrowed values - fees
    function resolveDispute(
        bytes32 _orderID,
        address payable _buyer,
        address _token,
        uint256 _amount,
        address payable _winner
    ) external onlyArbitrator returns (bool) {
        Escrow memory _escrow;
        bytes32 _orderHash;
        (_escrow, _orderHash) = getEscrowAndHash(
            _orderID,
            _buyer,
            _token,
            _amount
        );
        if (!_escrow.exists) {
            revert EscrowNotFound();
        }

        require(_escrow.dispute, "Dispute is not open");
        require(
            _winner == seller || _winner == _buyer,
            "Winner must be seller or buyer"
        );

        emit DisputeResolved(_orderHash, _winner);

        uint256 _fee = _winner == _buyer ? _escrow.fee : 0; // no fees if the trade is not done
        uint256 _openPeerFee = _winner == _buyer ? _escrow.openPeerFee : 0;

        transferEscrowAndFees(
            _orderHash,
            _buyer,
            _token,
            _winner,
            _winner == _buyer ? _amount : _amount + _escrow.fee,
            _fee,
            _escrow.partner,
            _openPeerFee,
            true,
            _escrow.automaticEscrow
        );
        return true;
    }

    /// @notice Transfer the value of an escrow
    /// @param _to Recipient address
    /// @param _amount Amount to be transfered
    /// @param _fee Fee to be transfered
    /// @param _disputeResolution Is a dispute being resolved?
    /// @param _automaticEscrow The escrow was done automatically
    function transferEscrowAndFees(
        bytes32 _orderHash,
        address payable _buyer,
        address _token,
        address payable _to,
        uint256 _amount,
        uint256 _fee,
        address payable _partner,
        uint256 _openPeerFee,
        bool _disputeResolution,
        bool _automaticEscrow
    ) private {
        delete escrows[_orderHash];
        bool sellerPaid = disputePayments[_orderHash][seller];
        bool buyerPaid = disputePayments[_orderHash][_buyer];
        delete disputePayments[_orderHash][seller];
        delete disputePayments[_orderHash][_buyer];

        // transfers the amount to the seller | buyer | this contract
        withdraw(_token, _to, _amount, _automaticEscrow);
        if (_openPeerFee > 0) {
            // transfers the OP fee to the fee recipient
            withdraw(_token, feeRecipient, _openPeerFee, false);
        }

        if (_fee - _openPeerFee > 0) {
            // transfers the OP fee to the fee recipient
            withdraw(_token, _partner, _fee - _openPeerFee, false);
        }

        if (_disputeResolution) {
            (bool sentToWinner, ) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to the winner");

            if (sellerPaid && buyerPaid) {
                (bool sent, ) = feeRecipient.call{value: disputeFee}("");
                require(
                    sent,
                    "Failed to send the fee MATIC to the fee recipient"
                );
            }
        } else if (sellerPaid && !buyerPaid) {
            // only the seller paid for the dispute, returns the fee to the seller
            (bool sent, ) = seller.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the seller");
        } else if (buyerPaid && !sellerPaid) {
            // only the buyer paid for the dispute, returns the fee to the buyer
            (bool sent, ) = _buyer.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the buyer");
        } else if (buyerPaid && sellerPaid) {
            // seller and buyer paid for the dispute, split the fee between the winner and the fee recipient
            (bool sentToWinner, ) = _to.call{value: disputeFee}("");
            require(sentToWinner, "Failed to send the fee MATIC to winner");

            (bool sent, ) = feeRecipient.call{value: disputeFee}("");
            require(sent, "Failed to send the fee MATIC to the fee recipient");
        }
    }

    /// @notice Withdraw values in the contract
    /// @param _token Address of the token to withdraw fees in to
    /// @param _to Address to withdraw fees in to
    /// @param _amount Amount to withdraw
    /// @param _updateBalancesOnly Update internal balances
    function withdraw(
        address _token,
        address payable _to,
        uint256 _amount,
        bool _updateBalancesOnly
    ) private {
        if (_updateBalancesOnly && _to == seller) {
            balancesInUse[_token] -= _amount;
        } else {
            if (_token == address(0)) {
                (bool sent, ) = _to.call{value: _amount}("");
                require(sent, "Failed to send tokens");
            } else {
                require(
                    IERC20(_token).transfer(_to, _amount),
                    "Failed to send tokens"
                );
            }
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
    ) private view returns (Escrow memory, bytes32) {
        bytes32 _orderHash = keccak256(
            abi.encodePacked(_orderID, seller, _buyer, _token, _amount)
        );
        return (escrows[_orderHash], _orderHash);
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

        return feeBps;
    }

    function sellerFee(address _partner) public view returns (uint256) {
        return
            openPeerFee() + IOpenPeerDeployer(deployer).partnerFeeBps(_partner);
    }

    /***********************************
    +   Deposit and withdraw           +
    ***********************************/

    // accept ETH deposits
    receive() external payable {}

    function withdrawBalance(address _token, uint256 _amount) external {
        require(balances(_token) >= _amount, "Not enough tokens in escrow");

        withdraw(_token, seller, _amount, false);
    }

    function balances(address _token) public view returns (uint256) {
        uint256 balance;
        if (_token == address(0)) {
            balance = address(this).balance;
        } else {
            balance = IERC20(_token).balanceOf(address(this));
        }

        return balance - balancesInUse[_token];
    }
}
