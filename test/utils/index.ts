import { keccak256, solidityPack } from 'ethers/lib/utils';

import { defaultAbiCoder } from '@ethersproject/abi';

export const generateTradeHash = ({
  orderID,
  sellerAddress,
  buyerAddress,
  tokenAddress,
  amount
}: {
  orderID: string;
  sellerAddress: string;
  buyerAddress: string;
  tokenAddress: string;
  amount: string;
}) => {
  const encodedValue = defaultAbiCoder.encode(['uint256'], [amount]).substring(2); // remove '0x' prefix and zero-padding

  const encodedParams = solidityPack(
    ['bytes32', 'address', 'address', 'address', 'uint256'],
    [orderID, sellerAddress, buyerAddress, tokenAddress, `0x${encodedValue}`]
  );

  return keccak256(encodedParams);
};
