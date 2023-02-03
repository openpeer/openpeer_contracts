import { expect } from 'chai';
import { BigNumber, constants } from 'ethers';
import { ethers } from 'hardhat';

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { OpenPeerEscrowsDeployer } from '../typechain-types';

describe('OpenPeerEscrowsDeployer', () => {
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
      constants.AddressZero
    );

    await contract.deployed();

    return { contract, owner, arbitrator, feeRecipient, fee };
  };

  describe('Deployment', () => {
    let deployer: OpenPeerEscrowsDeployer;
    let owner: SignerWithAddress;
    let arbitrator: SignerWithAddress;
    let feeRecipient: SignerWithAddress;
    let fee: number;
    const sellerWaitingTime: number = 24 * 60 * 60;

    beforeEach(async () => {
      const {
        contract,
        owner: contractOwner,
        arbitrator: contractArbitrator,
        feeRecipient: feeRecipientAddress,
        fee: contractFee
      } = await loadFixture(deploy);
      deployer = contract;
      owner = contractOwner;
      arbitrator = contractArbitrator;
      feeRecipient = feeRecipientAddress;
      fee = contractFee;
    });

    it('Should deploy successfully', async () => {
      expect(await deployer.owner()).to.be.equal(owner.address);
      expect(await deployer.arbitrator()).to.be.equal(arbitrator.address);
      expect(await deployer.feeRecipient()).to.be.equal(feeRecipient.address);
      expect(await deployer.fee()).to.be.equal(fee);
      expect(await deployer.sellerWaitingTime()).to.be.equal(sellerWaitingTime);
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
          await deployer.deployNativeEscrow(orderID, owner.address, '1000');
          await expect(
            deployer.deployNativeEscrow(orderID, feeRecipient.address, '1000')
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
        await deployer.setFeeRecipient(constants.AddressZero);
        expect(await deployer.feeRecipient()).to.equal(constants.AddressZero);
      });

      it('Should update the arbitrator', async () => {
        expect(await deployer.arbitrator()).to.equal(arbitrator.address);
        await deployer.setArbitrator(constants.AddressZero);
        expect(await deployer.arbitrator()).to.equal(constants.AddressZero);
      });
    });

    describe('Deploy', () => {
      const buyer = '0xad0637645341A160c4621a5AE22A709fECA37234';
      const orderID = ethers.utils.formatBytes32String('1');

      describe('Native token', () => {
        it('Should emit a EscrowCreated event', async () => {
          await expect(deployer.deployNativeEscrow(orderID, buyer, '1000'))
            .to.emit(deployer, 'EscrowCreated')
            .withArgs(
              orderID,
              ([exists, _, sellerAddress, buyerAddress, token, amount]: any) =>
                exists &&
                sellerAddress === owner.address &&
                buyerAddress === buyer &&
                token === constants.AddressZero &&
                BigNumber.from('1000').eq(amount)
            );
        });

        it('Should be available in the escrows list', async () => {
          await deployer.deployNativeEscrow(orderID, buyer, '1000');
          const [exists, _, sellerAddress, buyerAddress, token, amount] =
            await deployer.escrows(orderID);
          expect(exists).to.be.true;
          expect(sellerAddress).to.be.eq(owner.address);
          expect(buyerAddress).to.be.eq(buyer);
          expect(token).to.be.eq(constants.AddressZero);
          expect(amount).to.be.eq(BigNumber.from('1000'));
        });
      });

      describe('ERC20 tokens', () => {
        const tokenAddress = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

        it('Should emit a EscrowCreated event', async () => {
          await expect(deployer.deployERC20Escrow(orderID, buyer, tokenAddress, '1000'))
            .to.emit(deployer, 'EscrowCreated')
            .withArgs(
              orderID,
              ([exists, _, sellerAddress, buyerAddress, token, amount]: any) =>
                exists &&
                sellerAddress === owner.address &&
                buyerAddress === buyer &&
                token === tokenAddress &&
                BigNumber.from('1000').eq(amount)
            );
        });

        it('Should be available in the escrows list', async () => {
          await deployer.deployERC20Escrow(orderID, buyer, tokenAddress, '1000');
          const [exists, _, sellerAddress, buyerAddress, token, amount] =
            await deployer.escrows(orderID);
          expect(exists).to.be.true;
          expect(sellerAddress).to.be.eq(owner.address);
          expect(buyerAddress).to.be.eq(buyer);
          expect(token).to.be.eq(tokenAddress);
          expect(amount).to.be.eq(BigNumber.from('1000'));
        });
      });
    });
  });
});
