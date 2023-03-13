import { expect } from 'chai';
import { BigNumber, constants, VoidSigner } from 'ethers';
import { ethers } from 'hardhat';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import {
  ERC20,
  OpenPeerEscrow,
  OpenPeerEscrowsDeployer,
  Token
} from '../typechain-types';
import { OpenPeerEscrowProps } from '../types/OpenPeerEscrow.types';
import { formatBytes32String, parseBytes32String, parseUnits } from 'ethers/lib/utils';
import { generateTradeHash } from './utils';

const DISPUTE_FEE = constants.WeiPerEther;

const ONE_DAY_IN_SECS = 24 * 60 * 60;
// Minus 1 MATIC from the dispute fee and minus 1003 gwei from the escrow
const escrowBalance = parseUnits('1.000000000000001003').mul(-1);
// Won the 1 MATIC from the dispute back plus the escrow minus the taxes
const winnerBalance = parseUnits('1.000000000000001000');

describe('OpenPeerEscrow', () => {
  let escrow: OpenPeerEscrow;
  let erc20: ERC20;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let token: string;
  let amount: string;
  let feeRecipient: SignerWithAddress;
  let arbitrator: SignerWithAddress;

  const loadAccounts = async () => {
    const [sellerAccount, buyerAccount, arbitratorAccount, feeRecipientAccount] =
      await ethers.getSigners();
    seller = sellerAccount;
    buyer = buyerAccount;
    feeRecipient = feeRecipientAccount;
    arbitrator = arbitratorAccount;
  };

  const createDeployer = async () => {
    const OpenPeerEscrowsDeployer = await ethers.getContractFactory(
      'OpenPeerEscrowsDeployer'
    );
    const [owner] = await ethers.getSigners();
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

  const deploy = async ({
    buyerAccount,
    token = constants.AddressZero,
    amount = '1000',
    fee = '30',
    useERC20 = false
  }: OpenPeerEscrowProps) => {
    await loadAccounts();

    const { contract: deployer } = await loadFixture(createDeployer);
    const orderID = ethers.utils.formatBytes32String('1');
    buyerAccount = buyerAccount || buyer;
    let tokenAddress = token;
    let erc20Contract: Token | undefined;

    const bpsFee = BigNumber.from(amount)
      .mul(BigNumber.from(fee))
      .div(BigNumber.from('10000'));
    const amountWithFee = BigNumber.from(amount).add(bpsFee).toString();

    if (useERC20) {
      const Token = await ethers.getContractFactory('Token');
      erc20Contract = await Token.deploy();
      tokenAddress = erc20Contract.address;
      await erc20Contract.approve(deployer.address, 100000);
      await deployer.deployERC20Escrow(
        orderID,
        buyerAccount.address,
        tokenAddress,
        amount
      );
    } else {
      await deployer.deployNativeEscrow(orderID, buyerAccount.address, amount, {
        value: amountWithFee
      });
    }

    const [seller] = await ethers.getSigners();
    const tradeHash = generateTradeHash({
      orderID,
      sellerAddress: seller.address,
      buyerAddress: buyerAccount.address,
      tokenAddress,
      amount,
      fee
    });
    const [_, address] = await deployer.escrows(tradeHash);
    const OpenPeerEscrow = await ethers.getContractFactory('OpenPeerEscrow');
    const escrow = OpenPeerEscrow.attach(address);

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
      expect(await escrow.arbitrator()).to.equal(arbitrator.address);
      expect(await escrow.amount()).to.equal(amount);
      expect(await escrow.fee()).to.equal(3);
      expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
      expect(await escrow.sellerCanCancelAfter()).to.equal(
        (await time.latest()) + ONE_DAY_IN_SECS
      );
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

  describe('Release', () => {
    describe('Native token', () => {
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

      describe('With a dispute', () => {
        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, 1000, 3, DISPUTE_FEE]
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, winnerBalance, 3, 0]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [
                escrowBalance.add(DISPUTE_FEE.mul(-1)), // 1 MATIC from seller + 1 MATIC from buyer + 1003 from escrow
                winnerBalance,
                DISPUTE_FEE.add(BigNumber.from('3')), // 1 MATIC from dispute fee + 3 wei from fee
                0
              ]
            );
          });
        });
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(async () => {
        await deployWithERC20();
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

      describe('With a dispute', () => {
        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(escrow.release()).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [
                DISPUTE_FEE.mul(-2), // 1 MATIC from seller + 1 MATIC from buyer
                DISPUTE_FEE,
                DISPUTE_FEE,
                0
              ]
            );
          });
        });
      });
    });
  });

  describe('Buyer cancel', () => {
    let buyerAccount: SignerWithAddress;

    describe('Native token', () => {
      beforeEach(async () => {
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

      describe('With a dispute', () => {
        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, 0, 0, winnerBalance.add(BigNumber.from('3'))] // seller gets 1 MATIC from the dispute fee + escrowed values + fee
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, DISPUTE_FEE, 0, 1003]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [
                escrowBalance.add(DISPUTE_FEE.mul(-1)), // 1 MATIC from seller + 1 MATIC from buyer + 1003 from escrow
                0,
                DISPUTE_FEE,
                winnerBalance.add(BigNumber.from(3))
              ]
            );
          });
        });
      });
    });

    describe('ERC20 tokens', () => {
      beforeEach(async () => {
        await deployWithERC20();
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

      describe('With a dispute', () => {
        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.connect(buyer).markAsPaid();
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
            await expect(
              escrow.connect(buyerAccount).buyerCancel()
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
            );
          });
        });
      });
    });
  });

  describe('Seller cancel', () => {
    describe('Native token', () => {
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

  describe('Mark as paid', () => {
    let buyerAccount: SignerWithAddress;

    describe('Native token', () => {
      beforeEach(async () => {
        const [, secondAccount] = await ethers.getSigners();
        buyerAccount = secondAccount;
      });

      it('Should revert with an address different than buyer', async () => {
        await expect(escrow.markAsPaid()).to.be.revertedWith('Must be buyer');
      });

      it('Should set sellerCanCancelAfter as 1', async () => {
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
      await expect(
        escrow.connect(otherAddress).openDispute({ value: DISPUTE_FEE })
      ).to.be.revertedWith('Must be seller or buyer');
    });

    describe('As the seller', () => {
      it('Should revert if there is no dispute payment', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(escrow.openDispute()).to.be.revertedWith(
          'To open a dispute, you must pay 1 MATIC'
        );
      });

      it('Should revert if there is not enough for the dispute payment', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(escrow.openDispute({ value: '1000' })).to.be.revertedWith(
          'To open a dispute, you must pay 1 MATIC'
        );
      });

      it('Should revert with more than the dispute fee value', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(
          escrow.openDispute({ value: DISPUTE_FEE.add(BigNumber.from('1')) })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if the user already paid', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.openDispute({ value: DISPUTE_FEE });
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.be.revertedWith(
          'This address already paid for the dispute'
        );
      });

      it('Should mark the dispute as paid by the seller', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.openDispute({ value: DISPUTE_FEE });
        expect(await escrow.paidForDispute(buyerAccount.address)).to.be.equal(false);
        expect(await escrow.paidForDispute(seller.address)).to.be.equal(true);
      });

      it('Should transfer 1 MATIC to the contract', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [DISPUTE_FEE, DISPUTE_FEE.mul(-1), 0, 0]
        );
      });

      it('Should return true', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.openDispute({ value: DISPUTE_FEE });
        expect(await escrow.dispute()).to.true;
      });

      it('Should emit an DisputeOpened event', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.emit(
          escrow,
          'DisputeOpened'
        );
      });
    });

    describe('As the buyer', () => {
      it('Should revert if there is no dispute payment', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(escrow.connect(buyerAccount).openDispute()).to.be.revertedWith(
          'To open a dispute, you must pay 1 MATIC'
        );
      });

      it('Should revert if there is not enough for the dispute payment', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(
          escrow.connect(buyerAccount).openDispute({ value: '1000' })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert with more than the dispute fee value', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(
          escrow
            .connect(buyerAccount)
            .openDispute({ value: DISPUTE_FEE.add(BigNumber.from('1')) })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if the user already paid', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE });
        await expect(
          escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE })
        ).to.be.revertedWith('This address already paid for the dispute');
      });

      it('Should mark the dispute as paid by the buyer', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE });
        expect(await escrow.paidForDispute(buyerAccount.address)).to.be.equal(true);
        expect(await escrow.paidForDispute(seller.address)).to.be.equal(false);
      });

      it('Should transfer 1 MATIC to the contract', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(
          escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE })
        ).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [DISPUTE_FEE, 0, DISPUTE_FEE.mul(-1), 0]
        );
      });

      it('Should return true', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE });
        expect(await escrow.dispute()).to.true;
      });

      it('Should emit an DisputeOpened event', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await expect(
          escrow.connect(buyerAccount).openDispute({ value: DISPUTE_FEE })
        ).to.emit(escrow, 'DisputeOpened');
      });
    });

    describe('Native token', () => {
      it('Should revert with if there are no funds', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.release();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.be.revertedWith(
          'No funds to dispute'
        );
      });

      it('Should revert with if the buyer did not mark as paid', async () => {
        await escrow.release();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.be.revertedWith(
          'Cannot open a dispute yet'
        );
      });
    });

    describe('ERC20 token', () => {
      beforeEach(async () => {
        await deployWithERC20();
      });

      it('Should revert with if there are no funds', async () => {
        await escrow.connect(buyerAccount).markAsPaid();
        await escrow.release();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.be.revertedWith(
          'No funds to dispute'
        );
      });

      it('Should revert with if the buyer did not mark as paid', async () => {
        await escrow.release();
        await expect(escrow.openDispute({ value: DISPUTE_FEE })).to.be.revertedWith(
          'Cannot open a dispute yet'
        );
      });
    });
  });

  describe('Resolve dispute', () => {
    let arbitrator: SignerWithAddress;

    beforeEach(async () => {
      const [, buyerAccount, otherAccount] = await ethers.getSigners();
      arbitrator = otherAccount;
      buyer = buyerAccount;
      await escrow.connect(buyerAccount).markAsPaid();
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
      await escrow.openDispute({ value: DISPUTE_FEE });
      await expect(
        escrow.connect(arbitrator).resolveDispute(constants.AddressZero)
      ).to.be.revertedWith('Winner must be seller or buyer');
    });

    it('Should emit an DisputeResolved event', async () => {
      await escrow.openDispute({ value: DISPUTE_FEE });
      await expect(escrow.connect(arbitrator).resolveDispute(seller.address)).to.emit(
        escrow,
        'DisputeResolved'
      );
    });

    describe('Valid resolutions', () => {
      describe('Native token', () => {
        describe('When only the seller paid', () => {
          beforeEach(async () => {
            await escrow.openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(seller.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, winnerBalance, 0, 3]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(buyer.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, 0, winnerBalance, 3]
              );
            });
          });
        });

        describe('When only the buyer paid', () => {
          beforeEach(async () => {
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(seller.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, winnerBalance, 0, 3]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(buyer.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, 0, winnerBalance, 3]
              );
            });
          });
        });

        describe('When both parts paid', () => {
          beforeEach(async () => {
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(seller.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [
                  escrowBalance.add(DISPUTE_FEE.mul(-1)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1003)
                  winnerBalance,
                  0,
                  DISPUTE_FEE.add(BigNumber.from(3)) // arbitration fee + escrow fee
                ]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(buyer.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [
                  escrowBalance.add(DISPUTE_FEE.mul(-1)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1003)
                  0,
                  winnerBalance,
                  DISPUTE_FEE.add(BigNumber.from(3)) // arbitration fee + escrow fee
                ]
              );
            });
          });
        });
      });

      describe('ERC20 tokens', () => {
        beforeEach(async () => {
          await deployWithERC20();
          await escrow.connect(buyer).markAsPaid();
        });

        describe('When only the seller paid', () => {
          beforeEach(async () => {
            await escrow.openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              expect((await erc20.balanceOf(escrow.address)).toString()).to.equal('1003');
              expect(await escrow.dispute()).to.true;

              await expect(escrow.connect(arbitrator).resolveDispute(seller.address))
                .to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 1000, 0, 3]
                )
                .to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(escrow.connect(arbitrator).resolveDispute(buyer.address))
                .to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 0, 1000, 3]
                )
                .to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
                );
            });
          });
        });

        describe('When only the buyer paid', () => {
          beforeEach(async () => {
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(seller.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(buyer.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
              );
            });
          });
        });

        describe('When both parts paid', () => {
          beforeEach(async () => {
            await escrow.openDispute({ value: DISPUTE_FEE });
            await escrow.connect(buyer).openDispute({ value: DISPUTE_FEE });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(seller.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [DISPUTE_FEE.mul(-2), DISPUTE_FEE, 0, DISPUTE_FEE]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow.connect(arbitrator).resolveDispute(buyer.address)
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
              );
            });
          });
        });
      });
    });
  });

  it('Should return a version recipient', async () => {
    expect(await escrow.versionRecipient()).to.equal('1.0');
  });
});
