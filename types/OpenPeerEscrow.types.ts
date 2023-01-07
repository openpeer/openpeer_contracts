import { VoidSigner } from 'ethers';

import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

export interface OpenPeerEscrowProps {
  buyerAccount?: SignerWithAddress | VoidSigner;
  token?: string;
  amount?: string;
  fee?: string;
  useERC20?: boolean;
}
