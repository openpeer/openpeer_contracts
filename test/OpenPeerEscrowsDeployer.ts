import { expect } from 'chai';
import { constants } from 'ethers';
import { solidityKeccak256 } from 'ethers/lib/utils';
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
    const contract: OpenPeerEscrowsDeployer = await OpenPeerEscrowsDeployer.deploy(
      arbitrator.address,
      feeRecipient.address,
      fee
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

    describe('Native token', () => {
      let newEscrowAddress: string;
      let newEscrowHash: string;

      beforeEach(() => {
        newEscrowAddress = '0xfaC68Fded9F4345dBA71B1509Cd02DF2E4f2d207';
        newEscrowHash = solidityKeccak256(
          [
            'address',
            'address',
            'address',
            'address',
            'uint256',
            'uint8',
            'address',
            'address'
          ],
          [
            newEscrowAddress,
            owner.address,
            '0xad0637645341a160c4621a5ae22a709feca37234',
            constants.AddressZero,
            '1000',
            '30',
            arbitrator.address,
            feeRecipient.address
          ]
        );
      });

      it('Should emit a EscrowCreated event', async () => {
        await expect(
          deployer.deployNativeEscrow(
            '0xad0637645341a160c4621a5ae22a709feca37234',
            '1000'
          )
        )
          .to.emit(deployer, 'EscrowCreated')
          .withArgs(newEscrowAddress, newEscrowHash);
      });

      it('Should save the new escrow data', async () => {
        await deployer.deployNativeEscrow(
          '0xad0637645341a160c4621a5ae22a709feca37234',
          '1000'
        );
        expect(await deployer.escrows(newEscrowAddress)).to.equal(newEscrowHash);
      });
    });
    describe('ERC20 tokens', () => {
      let newEscrowAddress: string;
      let newEscrowHash: string;
      const tokenAddress = '0xc2132d05d31c914a87c6611c10748aeb04b58e8f';

      beforeEach(async () => {
        newEscrowAddress = '0xfaC68Fded9F4345dBA71B1509Cd02DF2E4f2d207';
        newEscrowHash = solidityKeccak256(
          [
            'address',
            'address',
            'address',
            'address',
            'uint256',
            'uint8',
            'address',
            'address'
          ],
          [
            newEscrowAddress,
            owner.address,
            '0xad0637645341a160c4621a5ae22a709feca37234',
            tokenAddress,
            '1000',
            '30',
            arbitrator.address,
            feeRecipient.address
          ]
        );
      });

      it('Should emit a EscrowCreated event', async () => {
        await expect(
          deployer.deployERC20Escrow(
            '0xad0637645341a160c4621a5ae22a709feca37234',
            tokenAddress,
            '1000'
          )
        )
          .to.emit(deployer, 'EscrowCreated')
          .withArgs(newEscrowAddress, newEscrowHash);
      });

      it('Should save the new escrow data', async () => {
        await deployer.deployERC20Escrow(
          '0xad0637645341a160c4621a5ae22a709feca37234',
          tokenAddress,
          '1000'
        );
        expect(await deployer.escrows(newEscrowAddress)).to.equal(newEscrowHash);
      });
    });
  });
});
