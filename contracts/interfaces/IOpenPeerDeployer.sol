// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IOpenPeerDeployer {
  function partnerFeeBps(address _partner) external view returns (uint256);
}