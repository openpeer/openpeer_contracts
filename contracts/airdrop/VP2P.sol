// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract VP2P is ERC20Upgradeable, OwnableUpgradeable {
    mapping(address => bool) public whitelist;
    mapping(uint8 => Round) public rounds;
    mapping(uint8 => mapping(address => bool)) public redeemedBy;

    struct Round {
        uint256 endDate;
        bytes32 distributionMerkleRoot;
    }

    function initialize() external initializer {
        __ERC20_init("VP2P", "VP2P");
        __Ownable_init();
    }

    function addWhitelist(address _user) external onlyOwner {
        whitelist[_user] = true;
    }

    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    ) internal view override {
        require(_from == address(0) || whitelist[_from], "transfers disabled");
    }

    function createRound(uint8 _round, uint256 _endDate, bytes32 _merkleRoot) external onlyOwner {
        require(_endDate < block.timestamp, "End date must be in the past");

        Round storage round = rounds[_round];
        require(round.endDate == 0, "Round already exists");

        round.endDate = _endDate;
        round.distributionMerkleRoot = _merkleRoot;
    }

    function claim(uint8 _round, uint256 _amount, bytes32[] calldata _merkleProof) external {
        Round storage round = rounds[_round];
        require(round.endDate > 0, "Round does not exist");
        require(!redeemedBy[_round][msg.sender], "Tokens have already been claimed");

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, _amount))));
        require(MerkleProof.verify(_merkleProof, round.distributionMerkleRoot, leaf), "Invalid proof");

        redeemedBy[_round][msg.sender] = true;
        _mint(msg.sender, _amount);
    }
}

