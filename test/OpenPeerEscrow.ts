import { expect } from 'chai';
import { constants, VoidSigner } from 'ethers';
import { ethers } from 'hardhat';

import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { ERC20, OpenPeerEscrow } from '../typechain-types';
import { OpenPeerEscrowProps } from '../types/OpenPeerEscrow.types';

const ONE_DAY_IN_SECS = 24 * 60 * 60;
describe('OpenPeerEscrow', () => {
  let escrow: OpenPeerEscrow;
  let erc20: ERC20;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let token: string;
  let amount: string;
  let arbitrator: SignerWithAddress;
  let feeRecipient: SignerWithAddress;

  const loadAccounts = async () => {
    const [sellerAccount, buyerAccount, arbitratorAccount, feeRecipientAccount] =
      await ethers.getSigners();
    seller = sellerAccount;
    buyer = buyerAccount;
    arbitrator = arbitratorAccount;
    feeRecipient = feeRecipientAccount;
  };

  const deploy = async ({
    buyerAccount,
    token = constants.AddressZero,
    amount = '1000',
    fee = '30',
    useERC20 = false
  }: OpenPeerEscrowProps) => {
    await loadAccounts();
    const OpenPeerEscrow = await ethers.getContractFactory('OpenPeerEscrow');

    let tokenAddress = token;
    let erc20Contract;
    if (useERC20) {
      const Token = await ethers.getContractFactory('Token');
      erc20Contract = await Token.deploy();
      tokenAddress = erc20Contract.address;
    }
    buyerAccount = buyerAccount || buyer;
    const escrow = await OpenPeerEscrow.deploy(
      buyerAccount.address,
      tokenAddress,
      amount,
      fee,
      arbitrator.address,
      feeRecipient.address,
      constants.AddressZero
    );

    return {
      erc20Contract,
      escrow,
      token: tokenAddress,
      amount
    };
  };

  const deployWithERC20 = async () => {
    const {
      escrow: contract,
      token: tokenAddress,
      erc20Contract
    } = await deploy({
      useERC20: true
    });

    escrow = contract;
    token = tokenAddress;
    erc20 = erc20Contract!;
    erc20!.approve(contract.address, '100000');
  };

  beforeEach(async () => {
    const { escrow: contract, token: tokenAddress, amount: buyAmount } = await deploy({});

    escrow = contract;
    token = tokenAddress;
    amount = buyAmount;
  });

  describe('Deployment', () => {
    describe('Validations', () => {
      it('Should revert with 0 amount', async () => {
        const amount = '0';
        await expect(deploy({ amount })).to.be.revertedWith('Invalid amount');
      });
      it('Should revert with same buyer and seller', async () => {
        await expect(deploy({ buyerAccount: seller })).to.be.revertedWith(
          'Seller and buyer must be different'
        );
      });
      it('Should revert with burn address as buyer', async () => {
        await expect(
          deploy({
            buyerAccount: new VoidSigner(constants.AddressZero),
            token,
            amount
          })
        ).to.be.revertedWith('Invalid buyer');
      });
    });

    it('Should deploy successfully', async () => {
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.token()).to.equal(token);
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.amount()).to.equal(amount);
      expect(await escrow.fee()).to.equal(3);
      expect(await escrow.sellerCanCancelAfter()).to.equal(0);
      expect(await escrow.arbitrator()).to.equal(arbitrator.address);
      expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
    });

    describe('With small amounts', () => {
      beforeEach(async () => {
        const { escrow: contract } = await deploy({ amount: '100' });

        escrow = contract;
      });
      it('Should calculate the right fee', async () => {
        expect(await escrow.amount()).to.equal('100');
        expect(await escrow.fee()).to.equal(0);
      });
    });
  });

  describe('Escrow', () => {
    describe('Native token', () => {
      it('Should revert if funds were escrowed already', async () => {
        await escrow.escrow({ value: '1003' });
        await expect(escrow.escrow({ value: '1003' })).to.be.revertedWith(
          'Funds already escrowed'
        );
      });
      it('Should revert with a smaller amount', async () => {
        await expect(escrow.escrow({ value: '100' })).to.be.revertedWith(
          'Incorrect MATIC sent'
        );
      });
      it('Should revert with a bigger amount', async () => {
        await expect(escrow.escrow({ value: '100000000' })).to.be.revertedWith(
          'Incorrect MATIC sent'
        );
      });
      it('Should set the time when the seller can cancel', async () => {
        await escrow.escrow({ value: '1003' });
        expect(await escrow.sellerCanCancelAfter()).to.equal(
          (await time.latest()) + ONE_DAY_IN_SECS
        );
      });
      it('Should transfer funds to the escrow contract', async () => {
        await expect(escrow.escrow({ value: '1003' })).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [1003, -1003, 0, 0]
        );
      });
      it('Should emit the Created event', async () => {
        await expect(escrow.escrow({ value: '1003' })).to.emit(escrow, 'Created');
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(deployWithERC20);

      it('Should revert if funds were escrowed already', async () => {
        await escrow.escrow();
        await expect(escrow.escrow()).to.be.revertedWith('Funds already escrowed');
      });

      it('Should set the time when the seller can cancel', async () => {
        await escrow.escrow();
        expect(await escrow.sellerCanCancelAfter()).to.equal(
          (await time.latest()) + ONE_DAY_IN_SECS
        );
      });
      it('Should transfer funds to the escrow contract', async () => {
        await expect(escrow.escrow()).to.changeTokenBalances(
          erc20,
          [escrow, seller, buyer, feeRecipient],
          [1003, -1003, 0, 0]
        );
      });
      it('Should emit the Created event', async () => {
        await expect(escrow.escrow()).to.emit(escrow, 'Created');
      });
    });
  });

  describe('Release', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.escrow({ value: '1003' });
      });
      it('Should revert with an address different than buyer', async () => {
        const [, buyerAccount] = await ethers.getSigners();
        await expect(escrow.connect(buyerAccount).release()).to.be.revertedWith(
          'Must be seller'
        );
      });
      it('Should transfer funds to the buyer and fee recipient', async () => {
        await expect(escrow.release()).to.changeEtherBalances(
          [escrow, buyer, feeRecipient, seller],
          [-1003, 1000, 3, 0]
        );
      });
      it('Should emit the Released event', async () => {
        await expect(escrow.release()).to.emit(escrow, 'Released');
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(async () => {
        await deployWithERC20();
        await escrow.escrow();
      });
      it('Should revert with an address different than seller', async () => {
        const [, buyerAccount] = await ethers.getSigners();
        await expect(escrow.connect(buyerAccount).release()).to.be.revertedWith(
          'Must be seller'
        );
      });
      it('Should transfer funds to the buyer and fee recipient', async () => {
        await expect(escrow.release()).to.changeTokenBalances(
          erc20,
          [escrow, buyer, feeRecipient, seller],
          [-1003, 1000, 3, 0]
        );
      });
      it('Should emit the Released event', async () => {
        await expect(escrow.release()).to.emit(escrow, 'Released');
      });
    });
  });

  describe('Buyer cancel', () => {
    let buyerAccount: SignerWithAddress;

    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.escrow({ value: '1003' });
        const [, secondAccount] = await ethers.getSigners();
        buyerAccount = secondAccount;
      });
      it('Should revert with an address different than buyer', async () => {
        await expect(escrow.buyerCancel()).to.be.revertedWith('Must be buyer');
      });
      it('Should transfer funds to the seller', async () => {
        await expect(escrow.connect(buyerAccount).buyerCancel()).to.changeEtherBalances(
          [escrow, seller],
          [-1003, 1003]
        );
      });
      it('Should emit the CancelledByBuyer event', async () => {
        await expect(escrow.connect(buyerAccount).buyerCancel()).to.emit(
          escrow,
          'CancelledByBuyer'
        );
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(async () => {
        await deployWithERC20();
        await escrow.escrow();
        const [, secondAccount] = await ethers.getSigners();
        buyerAccount = secondAccount;
      });
      it('Should revert with an address different than buyer', async () => {
        await expect(escrow.buyerCancel()).to.be.revertedWith('Must be buyer');
      });
      it('Should transfer funds to the seller', async () => {
        await expect(escrow.connect(buyerAccount).buyerCancel()).to.changeTokenBalances(
          erc20,
          [escrow, seller],
          [-1003, 1003]
        );
      });
      it('Should emit the CancelledByBuyer event', async () => {
        await expect(escrow.connect(buyerAccount).buyerCancel()).to.emit(
          escrow,
          'CancelledByBuyer'
        );
      });
    });
  });

  describe('Seller cancel', () => {
    let buyerAccount: SignerWithAddress;

    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.escrow({ value: '1003' });
      });
      it('Should revert with an address different than buyer', async () => {
        const [, buyerAccount] = await ethers.getSigners();
        await expect(escrow.connect(buyerAccount).sellerCancel()).to.be.revertedWith(
          'Must be seller'
        );
      });

      it('Should not transfer funds if the seller cannot cancel', async () => {
        await expect(escrow.sellerCancel()).to.changeEtherBalances(
          [escrow, seller],
          [0, 0]
        );
      });

      it('Should transfer funds to the seller', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(escrow.sellerCancel()).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [-1003, 1003, 0, 0]
        );
      });

      it('Should emit the CancelledBySeller event', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(escrow.sellerCancel()).to.emit(escrow, 'CancelledBySeller');
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(async () => {
        await deployWithERC20();
        await escrow.escrow();
      });
      it('Should revert with an address different than seller', async () => {
        const [, buyerAccount] = await ethers.getSigners();
        await expect(escrow.connect(buyerAccount).sellerCancel()).to.be.revertedWith(
          'Must be seller'
        );
      });
      it('Should not transfer funds if the seller cannot cancel', async () => {
        await expect(escrow.sellerCancel()).to.changeTokenBalances(
          erc20,
          [escrow, seller],
          [0, 0]
        );
      });

      it('Should transfer funds to the seller', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(escrow.sellerCancel()).to.changeTokenBalances(
          erc20,
          [escrow, seller, buyer, feeRecipient],
          [-1003, 1003, 0, 0]
        );
      });

      it('Should emit the CancelledBySeller event', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(escrow.sellerCancel()).to.emit(escrow, 'CancelledBySeller');
      });
    });
  });

  describe('Buyer cancel', () => {
    let buyerAccount: SignerWithAddress;

    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.escrow({ value: '1003' });
        const [, secondAccount] = await ethers.getSigners();
        buyerAccount = secondAccount;
      });
      it('Should revert with an address different than buyer', async () => {
        await expect(escrow.markAsPaid()).to.be.revertedWith('Must be buyer');
      });
      it('Should transfer funds to the seller', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        expect(await escrow.sellerCanCancelAfter()).to.equal(1);
      });
      it('Should emit the SellerCancelDisabled event', async () => {
        await expect(escrow.connect(buyerAccount).markAsPaid()).to.emit(
          escrow,
          'SellerCancelDisabled'
        );
      });
    });
  });

  describe('Open dispute', () => {
    let buyerAccount: SignerWithAddress;
    let otherAddress: SignerWithAddress;

    beforeEach(async () => {
      const [, secondAccount, otherAccount] = await ethers.getSigners();
      buyerAccount = secondAccount;
      otherAddress = otherAccount;
    });

    it('Should revert with an address different than seller or buyer', async () => {
      await expect(escrow.connect(otherAddress).openDispute()).to.be.revertedWith(
        'Must be seller or buyer'
      );
    });

    it('Should revert with if the funds were not escrowed', async () => {
      await expect(escrow.openDispute()).to.be.revertedWith('Funds not escrowed yet');
    });

    it('Should open a dispute from seller', async () => {
      await escrow.escrow({ value: '1003' });
      await escrow.openDispute();
      expect(await escrow.dispute()).to.true;
    });

    it('Should open a dispute from buyer', async () => {
      await escrow.escrow({ value: '1003' });
      await escrow.connect(buyerAccount).openDispute();
      expect(await escrow.dispute()).to.true;
    });

    it('Should emit an DisputeOpened event', async () => {
      await escrow.escrow({ value: '1003' });
      await expect(escrow.openDispute()).to.emit(escrow, 'DisputeOpened');
    });
  });

  describe('Resolve dispute', () => {
    let arbitrator: SignerWithAddress;

    beforeEach(async () => {
      const [, , otherAccount] = await ethers.getSigners();
      arbitrator = otherAccount;
    });

    it('Should revert with an address different than arbitrator', async () => {
      await expect(escrow.resolveDispute(arbitrator.address)).to.be.revertedWith(
        'Must be arbitrator'
      );
    });

    it('Should revert if the dispute is not open', async () => {
      await expect(
        escrow.connect(arbitrator).resolveDispute(seller.address)
      ).to.be.revertedWith('Dispute is not open');
    });

    it('Should revert with a wrong winner', async () => {
      await escrow.escrow({ value: '1003' });
      await escrow.openDispute();
      await expect(
        escrow.connect(arbitrator).resolveDispute(constants.AddressZero)
      ).to.be.revertedWith('Winner must be seller or buyer');
    });

    it('Should emit an DisputeResolved event', async () => {
      await escrow.escrow({ value: '1003' });
      await escrow.openDispute();
      await expect(escrow.connect(arbitrator).resolveDispute(seller.address)).to.emit(
        escrow,
        'DisputeResolved'
      );
    });

    describe('Valid resolutions', () => {
      describe('Native token', () => {
        beforeEach(async () => {
          await escrow.escrow({ value: '1003' });
          await escrow.openDispute();
        });

        it('Should result with the seller as winner', async () => {
          await expect(
            escrow.connect(arbitrator).resolveDispute(seller.address)
          ).to.changeEtherBalances(
            [escrow, seller, buyer, feeRecipient],
            [-1003, 1000, 0, 3]
          );
        });
        it('Should result with the buyer as winner', async () => {
          await expect(
            escrow.connect(arbitrator).resolveDispute(buyer.address)
          ).to.changeEtherBalances(
            [escrow, seller, buyer, feeRecipient],
            [-1003, 0, 1000, 3]
          );
        });
      });

      describe('ERC20 tokens', () => {
        beforeEach(async () => {
          await deployWithERC20();
          await escrow.escrow();
          await escrow.openDispute();
        });
        it('Should result with the seller as winner', async () => {
          expect((await erc20.balanceOf(escrow.address)).toString()).to.equal('1003');
          expect(await escrow.dispute()).to.true;

          await expect(
            escrow.connect(arbitrator).resolveDispute(seller.address)
          ).to.changeTokenBalances(
            erc20,
            [escrow, seller, buyer, feeRecipient],
            [-1003, 1000, 0, 3]
          );
        });
        it('Should result with the buyer as winner', async () => {
          await expect(
            escrow.connect(arbitrator).resolveDispute(buyer.address)
          ).to.changeTokenBalances(
            erc20,
            [escrow, seller, buyer, feeRecipient],
            [-1003, 0, 1000, 3]
          );
        });
      });
    });
  });
});
