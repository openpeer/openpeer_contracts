import { expect } from 'chai';
import { constants } from 'ethers';
import { ethers } from 'hardhat';

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { NFT, OpenPeerEscrowsDeployer, Token } from '../typechain-types';
import { generateTradeHash } from './utils';

describe('OpenPeerEscrowsDeployer', () => {
  let deployer: OpenPeerEscrowsDeployer;
  let owner: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let fee: number;
  let erc20: Token;
  const sellerWaitingTime: number = 24 * 60 * 60;

  beforeEach(async () => {
    const {
      contract,
      owner: contractOwner,
      arbitrator: contractArbitrator,
      feeRecipient: feeRecipientAddress,
      fee: contractFee,
      erc20Token
    } = await loadFixture(deploy);
    deployer = contract;
    owner = contractOwner;
    arbitrator = contractArbitrator;
    feeRecipient = feeRecipientAddress;
    fee = contractFee;
    erc20 = erc20Token;
  });

  const deploy = async () => {
    const OpenPeerEscrowsDeployer = await ethers.getContractFactory(
      'OpenPeerEscrowsDeployer'
    );
    const [owner, arbitrator, feeRecipient] = await ethers.getSigners();
    const fee = 30;
    const sellerWaitingTime = 24 * 60 * 60; // 24 hours in seconds
    const contract: OpenPeerEscrowsDeployer = await OpenPeerEscrowsDeployer.deploy(
      arbitrator.address,
      feeRecipient.address,
      fee,
      sellerWaitingTime,
      '0x69015912AA33720b842dCD6aC059Ed623F28d9f7',
      constants.AddressZero
    );

    await contract.deployed();

    const Token = await ethers.getContractFactory('Token');
    const erc20Token = await Token.deploy();
    await erc20Token.approve(contract.address, '100000');

    return { contract, owner, arbitrator, feeRecipient, fee, erc20Token };
  };

  describe('Deployment', () => {
    it('Should deploy successfully', async () => {
      expect(await deployer.owner()).to.be.equal(owner.address);
      expect(await deployer.arbitrator()).to.be.equal(arbitrator.address);
      expect(await deployer.feeRecipient()).to.be.equal(feeRecipient.address);
      expect(await deployer.fee()).to.be.equal(fee);
      expect(await deployer.sellerWaitingTime()).to.be.equal(sellerWaitingTime);
    });

    it('Should initialize the implementation', async () => {
      const implementation = await deployer.implementation();
      const escrow = await ethers.getContractFactory('OpenPeerEscrow');

      await expect(
        escrow
          .attach(implementation)
          .initialize(
            owner.address,
            arbitrator.address,
            constants.AddressZero,
            '1000',
            '30',
            arbitrator.address,
            feeRecipient.address,
            sellerWaitingTime,
            '0xf0511f123164602042ab2bCF02111fA5D3Fe97CD'
          )
      ).to.be.revertedWith('Initializable: contract is already initialized');
    });
  });

  describe('Settings', () => {
    describe('Validations', () => {
      beforeEach(() => {
        deployer = deployer.connect(arbitrator); // other rule other than owner
      });
      it('Should revert with non owner tries to update the fee', async () => {
        await expect(deployer.setFee(0)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
      it('Should revert with non owner tries to update the fee recipient', async () => {
        await expect(deployer.setFeeRecipient(arbitrator.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
      it('Should revert with non owner tries to update the arbitrator', async () => {
        await expect(deployer.setArbitrator(arbitrator.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });

      it('Should revert with an already deployed order', async () => {
        const orderID = ethers.utils.formatBytes32String('1');
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: owner.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await deployer.deployNativeEscrow(tradeHash, owner.address, '1000', {
          value: '1003'
        });
        await expect(
          deployer.deployNativeEscrow(tradeHash, owner.address, '1000', {
            value: '1003'
          })
        ).to.be.revertedWith('Order already exists');
      });
    });

    it('Should update the fee', async () => {
      expect(await deployer.fee()).to.equal(30);
      await deployer.setFee(15);
      expect(await deployer.fee()).to.equal(15);
    });

    it('Should update the fee recipient', async () => {
      expect(await deployer.feeRecipient()).to.equal(feeRecipient.address);
      await deployer.setFeeRecipient(owner.address);
      expect(await deployer.feeRecipient()).to.equal(owner.address);
    });

    it('Should update the arbitrator', async () => {
      expect(await deployer.arbitrator()).to.equal(arbitrator.address);
      await deployer.setArbitrator(owner.address);
      expect(await deployer.arbitrator()).to.equal(owner.address);
    });
  });

  describe('Fees', () => {
    const deployNFT = async () => {
      const NFTDeployer = await ethers.getContractFactory('NFT');
      const nft: NFT = await NFTDeployer.deploy();
      return { nft };
    };

    beforeEach(async () => {
      const { nft } = await loadFixture(deployNFT);
      await deployer.setFeeDiscountNFT(nft.address);
    });

    describe('With the fees discount NFT', () => {
      it('Should return fee with a 100% discount', async () => {
        expect(await deployer.fee()).to.equal(constants.Zero);
      });
    });

    describe('Without the fees discount NFT', () => {
      it('Should return fee without discounts', async () => {
        expect(await deployer.connect(arbitrator).fee()).to.equal(fee);
      });
    });
  });

  describe('Escrow', () => {
    const buyer = '0xad0637645341A160c4621a5AE22A709fECA37234';
    const orderID = ethers.utils.formatBytes32String('1');

    describe('Native token', () => {
      it('Should emit a EscrowCreated event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });

        await expect(
          deployer.deployNativeEscrow(orderID, buyer, '1000', { value: '1003' })
        )
          .to.emit(deployer, 'EscrowCreated')
          .withArgs(tradeHash, ([exists]: any) => exists);
      });

      it('Should be available in the escrows list', async () => {
        await deployer.deployNativeEscrow(orderID, buyer, '1000', {
          value: '1003'
        });
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        const [exists, _] = await deployer.escrows(tradeHash);
        expect(exists).to.be.true;
      });

      it('Should revert with a smaller amount', async () => {
        await expect(
          deployer.deployNativeEscrow(orderID, buyer, '1000', { value: '100' })
        ).to.be.revertedWith('Incorrect MATIC sent');
      });
      it('Should revert with a bigger amount', async () => {
        await expect(
          deployer.deployNativeEscrow(orderID, buyer, '1000', { value: '100000000' })
        ).to.be.revertedWith('Incorrect MATIC sent');
      });
      it('Should transfer funds to the escrow contract', async () => {
        await expect(
          deployer.deployNativeEscrow(orderID, buyer, '1000', { value: '1003' })
        ).to.changeEtherBalances(
          [deployer, owner, buyer, feeRecipient],
          [0, -1003, 0, 0]
        );

        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });

        const [_, escrow] = await deployer.escrows(tradeHash);
        expect(await ethers.provider.getBalance(escrow)).to.eq('1003');
      });
    });

    describe('ERC20 tokens', () => {
      it('Should emit a EscrowCreated event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        await expect(deployer.deployERC20Escrow(orderID, buyer, erc20.address, '1000'))
          .to.emit(deployer, 'EscrowCreated')
          .withArgs(tradeHash, ([exists]: any) => exists);
      });

      it('Should be available in the escrows list', async () => {
        await deployer.deployERC20Escrow(orderID, buyer, erc20.address, '1000');
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        const [exists, _] = await deployer.escrows(tradeHash);
        expect(exists).to.be.true;
      });

      it('Should transfer funds to the escrow contract', async () => {
        await expect(
          deployer.deployERC20Escrow(orderID, buyer, erc20.address, '1000')
        ).to.changeTokenBalances(
          erc20,
          [deployer, owner, buyer, feeRecipient],
          [0, -1003, 0, 0]
        );

        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: owner.address,
          buyerAddress: buyer,
          tokenAddress: erc20.address,
          amount: '1000'
        });

        const [_, escrow] = await deployer.escrows(tradeHash);
        expect(await erc20.balanceOf(escrow)).to.eq('1003');
      });
    });
  });
});
