import { defaultAbiCoder } from '@ethersproject/abi';
import { keccak256, solidityPack } from 'ethers/lib/utils';

export const generateTradeHash = ({
  orderID,
  sellerAddress,
  buyerAddress,
  tokenAddress,
  amount,
  fee
}: {
  orderID: string;
  sellerAddress: string;
  buyerAddress: string;
  tokenAddress: string;
  amount: string;
  fee: string;
}) => {
  const encodedValue = defaultAbiCoder.encode(['uint256'], [amount]).substring(2); // remove '0x' prefix and zero-padding
  const encodedFee = defaultAbiCoder.encode(['uint256'], [fee]).substring(2); // remove '0x' prefix and zero-padding

  const encodedParams = solidityPack(
    ['bytes32', 'address', 'address', 'address', 'uint256', 'uint256'],
    [
      orderID,
      sellerAddress,
      buyerAddress,
      tokenAddress,
      `0x${encodedValue}`,
      `0x${encodedFee}`
    ]
  );

  return keccak256(encodedParams);
};
