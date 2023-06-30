import { expect } from 'chai';
import { constants } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

import { VP2P } from '../../typechain-types';

describe('VP2P', () => {
  let vp2p: VP2P;
  let owner: SignerWithAddress;

  const deploy = async () => {
    const VP2PDeployer = await ethers.getContractFactory('VP2P');
    const [deployer] = await ethers.getSigners();
    const contract: VP2P = await VP2PDeployer.deploy();

    await contract.deployed();

    return { contract, deployer };
  };

  beforeEach(async () => {
    const { contract, deployer } = await loadFixture(deploy);
    vp2p = contract;
    owner = deployer;
  });

  describe('Deployment', () => {
    it('Should deploy successfully', async () => {
      expect(await vp2p.owner()).to.be.equal(constants.AddressZero);
      expect(await vp2p.name()).to.be.equal('');
      expect(await vp2p.symbol()).to.be.equal('');
      expect(await vp2p.decimals()).to.be.equal(18);
    });

    it('Should initialize the implementation', async () => {
      await vp2p.initialize();

      expect(await vp2p.owner()).to.be.equal(owner.address);
      expect(await vp2p.name()).to.be.equal('VP2P');
      expect(await vp2p.symbol()).to.be.equal('VP2P');
      expect(await vp2p.decimals()).to.be.equal(18);
    });

    it('Should revert if initialize is called twice', async () => {
      await vp2p.initialize();

      await expect(vp2p.initialize()).to.be.revertedWith(
        'Initializable: contract is already initialized'
      );
    });
  });

  describe('Initialized', () => {
    let distribution: [string, string][];
    let merkleTree: StandardMerkleTree<(string | string)[]>;
    let endDate: number;
    let amount: string;

    beforeEach(async () => {
      await vp2p.initialize();
      amount = parseUnits('1000').toString();
      distribution = [[owner.address, amount]];
      merkleTree = StandardMerkleTree.of(distribution, ['address', 'uint256']);
      endDate = Math.floor(Date.now() / 1000) - 1;
    });

    describe('Create round', () => {
      it('Should create a round', async () => {
        await vp2p.createRound(1, endDate, merkleTree.root);
        const [_endDate, distributionMerkleRoot] = await vp2p.rounds(1);
        expect(_endDate).to.be.equal(endDate);
        expect(distributionMerkleRoot).to.be.equal(merkleTree.root);
      });

      it('Should create multiple rounds', async () => {
        await vp2p.createRound(1, endDate, merkleTree.root);
        await vp2p.createRound(2, endDate, merkleTree.root);
      });

      it('Should revert if round exists', async () => {
        await vp2p.createRound(1, endDate, merkleTree.root);
        await expect(vp2p.createRound(1, endDate, merkleTree.root)).to.be.revertedWith(
          'Round already exists'
        );
      });

      it('Should revert end date is in the past', async () => {
        await expect(
          vp2p.createRound(1, (await time.latest()) + 1, merkleTree.root)
        ).to.be.revertedWith('End date must be in the past');
      });

      it('Should revert if not owner', async () => {
        const [_, notOwner] = await ethers.getSigners();
        await expect(
          vp2p.connect(notOwner).createRound(1, endDate, merkleTree.root)
        ).to.be.revertedWith('Ownable: caller is not the owner');
      });
    });

    describe('Claim', () => {
      let proof: string[];
      beforeEach(async () => {
        await vp2p.createRound(1, endDate, merkleTree.root);
        proof = merkleTree.getProof(distribution[0]);
      });

      it('Should claim tokens', async () => {
        await vp2p.claim(1, distribution[0][1], proof);
        const redeemed = await vp2p.redeemedBy(1, owner.address);
        expect(redeemed).to.be.true;
      });

      it('Should revert if round does not exist', async () => {
        await expect(vp2p.claim(2, distribution[0][1], proof)).to.be.revertedWith(
          'Round does not exist'
        );
      });

      it('Should revert if tokens have already been claimed', async () => {
        await vp2p.claim(1, distribution[0][1], proof);
        await expect(vp2p.claim(1, distribution[0][1], proof)).to.be.revertedWith(
          'Tokens have already been claimed'
        );
      });

      it('Should revert if amount is invalid', async () => {
        const wrongAmount = parseUnits('1001').toString();
        await expect(vp2p.claim(1, wrongAmount, proof)).to.be.revertedWith(
          'Invalid proof'
        );
      });

      it('Should revert if user is invalid', async () => {
        const [_, scammer] = await ethers.getSigners();
        const wrongTree = StandardMerkleTree.of(
          [[scammer.address, amount]],
          ['address', 'uint256']
        );
        const wrongProof = wrongTree.getProof([scammer.address, amount]);
        await expect(
          vp2p.connect(scammer).claim(1, amount, wrongProof)
        ).to.be.revertedWith('Invalid proof');
      });

      it('Should transfer the values', async () => {
        await expect(vp2p.claim(1, amount, proof)).to.changeTokenBalance(
          vp2p,
          owner.address,
          amount
        );
      });

      it('Should transfer the values', async () => {
        await expect(vp2p.claim(1, amount, [])).to.changeTokenBalance(
          vp2p,
          owner.address,
          amount
        );
      });
    });
  });
});
