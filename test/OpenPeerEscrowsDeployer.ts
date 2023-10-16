import { expect } from 'chai';
import { constants } from 'ethers';
import { ethers } from 'hardhat';

import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { NFT, OpenPeerEscrowsDeployer } from '../typechain-types';
import { parseUnits } from 'ethers/lib/utils';

describe('OpenPeerEscrowsDeployer', () => {
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

  const deploy = async () => {
    const OpenPeerEscrowsDeployer = await ethers.getContractFactory(
      'OpenPeerEscrowsDeployer'
    );
    const [owner, arbitrator, feeRecipient] = await ethers.getSigners();
    const fee = 30;
    const contract: OpenPeerEscrowsDeployer = await OpenPeerEscrowsDeployer.deploy(
      arbitrator.address,
      feeRecipient.address,
      fee,
      '0x69015912AA33720b842dCD6aC059Ed623F28d9f7',
      constants.AddressZero,
      parseUnits('1', 'ether')
    );

    await contract.deployed();

    return { contract, owner, arbitrator, feeRecipient, fee };
  };

  describe('Deployment', () => {
    it('Should deploy successfully', async () => {
      expect(await deployer.owner()).to.be.equal(owner.address);
      expect(await deployer.arbitrator()).to.be.equal(arbitrator.address);
      expect(await deployer.feeRecipient()).to.be.equal(feeRecipient.address);
      expect(await deployer.sellerFee(constants.AddressZero)).to.be.equal(fee);
      expect(await deployer.disputeFee()).to.be.equal(parseUnits('1', 'ether'));
    });

    it('Should initialize the implementation', async () => {
      const implementation = await deployer.implementation();
      const escrow = await ethers.getContractFactory('OpenPeerEscrow');

      await expect(
        escrow
          .attach(implementation)
          .initialize(
            owner.address,
            '30',
            arbitrator.address,
            feeRecipient.address,
            constants.AddressZero,
            '0xf0511f123164602042ab2bCF02111fA5D3Fe97CD',
            parseUnits('1', 'ether')
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
      it('Should revert with non owner tries to update the trustedForwarder', async () => {
        await expect(deployer.setTrustedForwarder(arbitrator.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
      it('Should revert with non owner tries to update the implementation', async () => {
        await expect(deployer.setImplementation(arbitrator.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
      it('Should revert with non owner tries to update the feeDiscountNFT', async () => {
        await expect(deployer.setFeeDiscountNFT(arbitrator.address)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
      it('Should revert with non owner tries to toggle the contract active', async () => {
        await expect(deployer.toggleContractActive()).to.be.revertedWith(
          'Ownable: caller is not the owner'
        );
      });
    });

    it('Should update the fee', async () => {
      expect(await deployer.sellerFee(constants.AddressZero)).to.equal(30);
      await deployer.setFee(15);
      expect(await deployer.sellerFee(constants.AddressZero)).to.equal(15);
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

    describe('With the fees discount NFT', () => {
      beforeEach(async () => {
        const { nft } = await loadFixture(deployNFT);
        await deployer.setFeeDiscountNFT(nft.address);
      });

      it('Should return fee with a 100% discount', async () => {
        expect(await deployer.sellerFee(constants.AddressZero)).to.equal(constants.Zero);
      });
    });

    describe('Without the fees discount NFT', () => {
      it('Should return fee without discounts', async () => {
        expect(
          await deployer.connect(arbitrator).sellerFee(constants.AddressZero)
        ).to.equal(fee);
      });
    });

    describe('With a seller fee', () => {
      it('Should return fee with the seller fee', async () => {
        await deployer.updatePartnerFeeBps([owner.address], [50]);
        // OP fee + seller fee
        expect(await deployer.sellerFee(owner.address)).to.equal(50 + fee);
      });
    });

    describe('Updating the partner fees', () => {
      it('Should revert with non owner tries to update the partner fees', async () => {
        await expect(
          deployer.connect(arbitrator).updatePartnerFeeBps([owner.address], [50])
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });

      it('Should revert with different array lengths', async () => {
        await expect(
          deployer.updatePartnerFeeBps([owner.address], [50, 50])
        ).to.be.revertedWith('Invalid input');
      });

      it('Should revert with invalid fee', async () => {
        await expect(
          deployer.updatePartnerFeeBps([owner.address], [101])
        ).to.be.revertedWith('Invalid fee bps');
      });

      it('Should revert with invalid address', async () => {
        await expect(
          deployer.updatePartnerFeeBps([constants.AddressZero], [50])
        ).to.be.revertedWith('Invalid partner address');
      });

      it('Should update the partner fees', async () => {
        await deployer.updatePartnerFeeBps([owner.address], [50]);
        expect(await deployer.partnerFeeBps(owner.address)).to.equal(50);
      });
    });
  });

  describe('Deploy', () => {
    it('Should emit a ContractCreated event', async () => {
      await expect(deployer.deploy())
        .to.emit(deployer, 'ContractCreated')
        .withArgs(owner.address, ([exists]: any) => exists);
    });

    it('Should be available in the seller contracts', async () => {
      await deployer.deploy();
      const address = await deployer.sellerContracts(owner.address);
      expect(!!address).to.be.true;
    });

    describe('Multiple contracts per seller', () => {
      it('Should create a second contract for the same seller', async () => {
        await deployer.deploy();
        await deployer.deploy();
        const address = await deployer.sellerContracts(owner.address);
        expect(!!address).to.be.true;
      });
    });
  });
});
