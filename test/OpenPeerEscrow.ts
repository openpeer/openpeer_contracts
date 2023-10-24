import { expect } from 'chai';
import { BigNumber, constants } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';
import { ethers } from 'hardhat';

import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

import { ERC20, OpenPeerEscrow, OpenPeerEscrowsDeployer } from '../typechain-types';
import { generateTradeHash } from './utils';

const FEE = 30;
const DISPUTE_FEE = constants.WeiPerEther;
const TRUSTED_FORWARDER = '0x69015912AA33720b842dCD6aC059Ed623F28d9f7';
const NFT_CONTRACT = constants.AddressZero;

const ONE_DAY_IN_SECS = 24 * 60 * 60;
// Minus 1 MATIC from the dispute fee and minus 1003 gwei from the escrow
const escrowBalance = parseUnits('1.000000000000001003').mul(-1);
// Won the 1 MATIC from the dispute back plus the escrow minus the taxes
const winnerBalance = parseUnits('1.000000000000001000');

describe('OpenPeerEscrow', () => {
  let deployer: OpenPeerEscrowsDeployer;
  let escrow: OpenPeerEscrow;
  let erc20: ERC20;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let arbitrator: SignerWithAddress;
  let partner: SignerWithAddress;
  let orderID = ethers.utils.formatBytes32String('1');

  const loadAccounts = async () => {
    const [
      sellerAccount,
      buyerAccount,
      arbitratorAccount,
      feeRecipientAccount,
      partnerAccount
    ] = await ethers.getSigners();
    seller = sellerAccount;
    buyer = buyerAccount;
    feeRecipient = feeRecipientAccount;
    arbitrator = arbitratorAccount;
    partner = partnerAccount;
  };

  const createDeployer = async () => {
    const OpenPeerEscrowsDeployer = await ethers.getContractFactory(
      'OpenPeerEscrowsDeployer'
    );
    const contract: OpenPeerEscrowsDeployer = await OpenPeerEscrowsDeployer.deploy(
      arbitrator.address,
      feeRecipient.address,
      FEE,
      TRUSTED_FORWARDER,
      NFT_CONTRACT,
      parseUnits('1', 'ether')
    );

    await contract.deployed();

    const Token = await ethers.getContractFactory('Token');
    const erc20Contract = await Token.deploy();

    return { contract, arbitrator, feeRecipient, fee: FEE, erc20Contract };
  };

  const deploy = async () => {
    await loadAccounts();
    const { contract: deployer, erc20Contract } = await loadFixture(createDeployer);
    await deployer.deploy();
    const address = await deployer.sellerContracts(seller.address);
    const OpenPeerEscrow = await ethers.getContractFactory('OpenPeerEscrow');
    const escrow = OpenPeerEscrow.attach(address);
    await erc20Contract.approve(address, 100000);

    return { escrow, erc20Contract, deployer };
  };

  beforeEach(async () => {
    const {
      escrow: contract,
      erc20Contract,
      deployer: deployerContract
    } = await deploy();
    deployer = deployerContract;
    escrow = contract;
    erc20 = erc20Contract;
  });

  describe('Create', () => {
    describe('Validations', () => {
      describe('Native token', () => {
        it('Should revert with 0 amount', async () => {
          await expect(
            escrow.createNativeEscrow(
              orderID,
              buyer.address,
              '0',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Invalid amount');
        });

        it('Should revert with same buyer and seller', async () => {
          await expect(
            escrow.createNativeEscrow(
              orderID,
              seller.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Seller and buyer must be different');
        });

        it('Should revert with burn address as buyer', async () => {
          await expect(
            escrow.createNativeEscrow(
              orderID,
              constants.AddressZero,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Invalid buyer');
        });

        it('Should revert with an already deployed order', async () => {
          await escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '1003'
            }
          );
          await expect(
            escrow.createNativeEscrow(
              orderID,
              buyer.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false,
              {
                value: '1003'
              }
            )
          ).to.be.revertedWith('Order already exists');
        });

        describe('With partner fee', () => {
          it('Should revert with an incorrect amount', async () => {
            await deployer.updatePartnerFeeBps([partner.address], [100]);

            await expect(
              escrow.createNativeEscrow(
                orderID,
                buyer.address,
                '1000',
                partner.address,
                ONE_DAY_IN_SECS,
                false,
                {
                  value: '1003'
                }
              )
            ).to.be.revertedWith('Incorrect amount sent');
          });
        });

        describe('With an invalid seller waiting time', () => {
          it('Should revert with less than 15 min', async () => {
            await expect(
              escrow.createNativeEscrow(
                orderID,
                buyer.address,
                '1000',
                partner.address,
                14 * 60 + 59, // 14 min + 59 secs
                false,
                {
                  value: '1003'
                }
              )
            ).to.be.revertedWith('Invalid seller waiting time');
          });

          it('Should revert with more than 24 hours', async () => {
            await expect(
              escrow.createNativeEscrow(
                orderID,
                buyer.address,
                '1000',
                partner.address,
                ONE_DAY_IN_SECS + 1, // 24 hours + 1 sec
                false,
                {
                  value: '1003'
                }
              )
            ).to.be.revertedWith('Invalid seller waiting time');
          });
        });

        describe('With instant escrow', () => {
          it('Should revert without balance', async () => {
            await expect(
              escrow.createNativeEscrow(
                orderID,
                buyer.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              )
            ).to.be.revertedWith('Not enough tokens in escrow');
          });
        });
      });

      describe('ERC20 token', () => {
        it('Should revert with 0 amount', async () => {
          await expect(
            escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '0',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Invalid amount');
        });

        it('Should revert with same buyer and seller', async () => {
          await expect(
            escrow.createERC20Escrow(
              orderID,
              seller.address,
              erc20.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Seller and buyer must be different');
        });

        it('Should revert with burn address as buyer', async () => {
          await expect(
            escrow.createERC20Escrow(
              orderID,
              constants.AddressZero,
              erc20.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Invalid buyer');
        });

        it('Should revert with an already deployed order', async () => {
          await escrow.createERC20Escrow(
            orderID,
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false
          );
          await expect(
            escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.be.revertedWith('Order already exists');
        });

        describe('With an invalid seller waiting time', () => {
          it('Should revert with less than 15 min', async () => {
            await expect(
              escrow.createERC20Escrow(
                orderID,
                buyer.address,
                erc20.address,
                '1000',
                partner.address,
                14 * 60 + 59, // 14 min + 59 secs
                false
              )
            ).to.be.revertedWith('Invalid seller waiting time');
          });

          it('Should revert with more than 24 hours', async () => {
            await expect(
              escrow.createERC20Escrow(
                orderID,
                buyer.address,
                erc20.address,
                '1000',
                partner.address,
                ONE_DAY_IN_SECS + 1, // 24 hours + 1 sec
                false
              )
            ).to.be.revertedWith('Invalid seller waiting time');
          });
        });
      });

      it('Should deploy successfully', async () => {
        expect(await escrow.seller()).to.equal(seller.address);
        expect(await escrow.arbitrator()).to.equal(arbitrator.address);
        expect(await escrow.feeRecipient()).to.equal(feeRecipient.address);
        expect(await escrow.feeDiscountNFT()).to.equal(NFT_CONTRACT);
        expect(await escrow.feeBps()).to.equal(FEE);
        expect(await escrow.deployer()).to.equal(deployer.address);
      });
    });

    describe('Native token', () => {
      it('Should emit a EscrowCreated event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });

        await expect(
          escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            { value: '1003' }
          )
        )
          .to.emit(escrow, 'EscrowCreated')
          .withArgs(tradeHash);
      });

      it('Should be available in the escrows list', async () => {
        await escrow.createNativeEscrow(
          orderID,
          buyer.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false,
          {
            value: '1003'
          }
        );
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        const [exists] = await escrow.escrows(tradeHash);
        expect(exists).to.be.true;
      });

      it('Should revert with a smaller amount', async () => {
        await expect(
          escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            { value: '100' }
          )
        ).to.be.revertedWith('Incorrect amount sent');
      });

      it('Should revert with a bigger amount', async () => {
        await expect(
          escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '100000000'
            }
          )
        ).to.be.revertedWith('Incorrect amount sent');
      });

      it('Should transfer funds to the escrow contract', async () => {
        await expect(
          escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            { value: '1003' }
          )
        ).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient, arbitrator],
          [1003, -1003, 0, 0, 0]
        );
      });

      describe('With a partner fee', () => {
        it('Should use the correct amount', async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await expect(
            escrow.createNativeEscrow(
              orderID,
              buyer.address,
              '1000',
              partner.address, // partner,
              ONE_DAY_IN_SECS,
              false,
              { value: '1013' } // 1000 from the seller + 10 to the partner fee + 3 to the op fee (in WEI)
            )
          ).to.changeEtherBalances(
            [escrow, seller, buyer, feeRecipient, arbitrator, partner],
            [1013, -1013, 0, 0, 0, 0]
          );
        });
      });

      describe('Escrow struct', () => {
        it('Should generate the right struct', async () => {
          await escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '1003'
            }
          );
          const tradeHash = generateTradeHash({
            orderID,
            sellerAddress: seller.address,
            buyerAddress: buyer.address,
            tokenAddress: constants.AddressZero,
            amount: '1000'
          });

          const [exists, sellerCanCancelAfter, fee, dispute] = await escrow.escrows(
            tradeHash
          );

          expect(exists).to.be.true;
          expect(sellerCanCancelAfter).to.equal((await time.latest()) + ONE_DAY_IN_SECS);
          expect(fee).to.equal(3);
          expect(dispute).to.be.false;
        });

        describe('With small amounts', () => {
          it('Should calculate the right fee', async () => {
            await escrow.createNativeEscrow(
              orderID,
              buyer.address,
              '100',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false,
              {
                value: '100'
              }
            );
            const tradeHash = generateTradeHash({
              orderID,
              sellerAddress: seller.address,
              buyerAddress: buyer.address,
              tokenAddress: constants.AddressZero,
              amount: '100'
            });

            const [, , fee] = await escrow.escrows(tradeHash);
            expect(fee).to.equal(0);
          });
        });
      });

      describe('With instant escrow', () => {
        it('Should remove the balance', async () => {
          await seller.sendTransaction({
            to: escrow.address,
            value: '1003'
          });
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');

          await escrow.createNativeEscrow(
            orderID,
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            true
          );
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
        });
      });
    });

    describe('ERC20 token', () => {
      it('Should emit a EscrowCreated event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        await expect(
          escrow.createERC20Escrow(
            orderID,
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false
          )
        )
          .to.emit(escrow, 'EscrowCreated')
          .withArgs(tradeHash);
      });

      it('Should be available in the escrows list', async () => {
        await escrow.createERC20Escrow(
          orderID,
          buyer.address,
          erc20.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false
        );
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        const [exists] = await escrow.escrows(tradeHash);
        expect(exists).to.be.true;
      });

      it('Should transfer funds to the escrow contract', async () => {
        await expect(
          escrow.createERC20Escrow(
            orderID,
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false
          )
        ).to.changeTokenBalances(
          erc20,
          [escrow, seller, buyer, feeRecipient],
          [1003, -1003, 0, 0]
        );
      });

      describe('With a partner fee', () => {
        it('Should use the correct amount', async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await expect(
            escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '1000',
              partner.address,
              ONE_DAY_IN_SECS,
              false
            )
          ).to.changeTokenBalances(
            erc20,
            [escrow, seller, buyer, feeRecipient, partner],
            [1013, -1013, 0, 0, 0]
          );
        });
      });

      describe('Escrow struct', () => {
        it('Should generate the right struct', async () => {
          await escrow.createERC20Escrow(
            orderID,
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            false
          );
          const tradeHash = generateTradeHash({
            orderID,
            sellerAddress: seller.address,
            buyerAddress: buyer.address,
            tokenAddress: erc20.address,
            amount: '1000'
          });

          const [exists, sellerCanCancelAfter, fee, dispute] = await escrow.escrows(
            tradeHash
          );

          expect(exists).to.be.true;
          expect(sellerCanCancelAfter).to.equal((await time.latest()) + ONE_DAY_IN_SECS);
          expect(fee).to.equal(3);
          expect(dispute).to.be.false;
        });

        describe('With small amounts', () => {
          it('Should calculate the right fee', async () => {
            await escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '100',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            );
            const tradeHash = generateTradeHash({
              orderID,
              sellerAddress: seller.address,
              buyerAddress: buyer.address,
              tokenAddress: erc20.address,
              amount: '100'
            });

            const [, , fee] = await escrow.escrows(tradeHash);
            expect(fee).to.equal(0);
          });
        });
      });

      describe('With instant escrow', () => {
        it('Should remove the balance', async () => {
          await erc20.transfer(escrow.address, '1003');

          expect(await escrow.balancesInUse(erc20.address)).to.equal('0');

          await escrow.createERC20Escrow(
            orderID,
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            true
          );
          expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
        });
      });
    });
  });

  describe('Release', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.createNativeEscrow(
          orderID,
          buyer.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false,
          {
            value: '1003'
          }
        );
      });

      it('Should fail with a not found escrow', async () => {
        await expect(
          escrow.release(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            constants.AddressZero,
            '1000'
          )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than seller', async () => {
        await expect(
          escrow
            .connect(buyer)
            .release(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('Must be seller');
      });

      it('Should emit the Released event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await expect(
          escrow.release(orderID, buyer.address, constants.AddressZero, '1000')
        )
          .to.emit(escrow, 'Released')
          .withArgs(tradeHash);
      });

      it('Should transfer funds to the buyer and fee recipient', async () => {
        await expect(
          escrow.release(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.changeEtherBalances(
          [escrow, buyer, feeRecipient, seller],
          [-1003, 1000, 3, 0]
        );
      });

      describe('With a dispute', () => {
        beforeEach(async () => {
          await escrow
            .connect(buyer)
            .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');
        });

        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
            await expect(
              escrow.release(orderID, buyer.address, constants.AddressZero, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, 1000, 3, DISPUTE_FEE]
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow.release(orderID, buyer.address, constants.AddressZero, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, winnerBalance, 3, 0]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow.release(orderID, buyer.address, constants.AddressZero, '1000')
            ).to.changeEtherBalances(
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

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createNativeEscrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '1013'
            }
          );
        });

        it('Should transfer funds to the buyer and fee recipient', async () => {
          await expect(
            escrow.release(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              constants.AddressZero,
              '1000'
            )
          ).to.changeEtherBalances(
            [escrow, buyer, feeRecipient, seller, partner],
            [-1013, 1000, 3, 0, 10]
          );
        });
      });
    });

    describe('ERC20 token', () => {
      beforeEach(async () => {
        await escrow.createERC20Escrow(
          orderID,
          buyer.address,
          erc20.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false
        );
      });

      it('Should fail with a not found escrow', async () => {
        await expect(
          escrow.release(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            erc20.address,
            '1000'
          )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than seller', async () => {
        await expect(
          escrow.connect(buyer).release(orderID, buyer.address, erc20.address, '1000')
        ).to.be.revertedWith('Must be seller');
      });

      it('Should transfer funds to the buyer and fee recipient', async () => {
        await expect(
          escrow.release(orderID, buyer.address, erc20.address, '1000')
        ).to.changeTokenBalances(
          erc20,
          [escrow, buyer, feeRecipient, seller],
          [-1003, 1000, 3, 0]
        );
      });

      it('Should emit the Released event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        await expect(escrow.release(orderID, buyer.address, erc20.address, '1000'))
          .to.emit(escrow, 'Released')
          .withArgs(tradeHash);
      });

      describe('With a dispute', () => {
        beforeEach(async () => {
          await escrow
            .connect(buyer)
            .markAsPaid(orderID, buyer.address, erc20.address, '1000');
        });
        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
              value: DISPUTE_FEE
            });
            await expect(
              escrow.release(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
            );
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow.release(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
            );
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
              value: DISPUTE_FEE
            });
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow.release(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
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

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createERC20Escrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false
          );
        });

        it('Should transfer funds to the buyer and fee recipient', async () => {
          await expect(
            escrow.release(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              erc20.address,
              '1000'
            )
          ).to.changeTokenBalances(
            erc20,
            [escrow, buyer, feeRecipient, seller, partner],
            [-1013, 1000, 3, 0, 10]
          );
        });
      });
    });
  });

  describe('Buyer cancel', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.createNativeEscrow(
          orderID,
          buyer.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false,
          {
            value: '1003'
          }
        );
      });

      it('Should fail with a not found escrow', async () => {
        await expect(
          escrow
            .connect(buyer)
            .buyerCancel(
              ethers.utils.formatBytes32String('10000'),
              buyer.address,
              constants.AddressZero,
              '1000'
            )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than buyer', async () => {
        await expect(
          escrow.buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('Must be buyer');
      });

      it('Should transfer funds to the seller', async () => {
        await expect(
          escrow
            .connect(buyer)
            .buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.changeEtherBalances([escrow, seller], [-1003, 1003]);
      });

      it('Should emit the CancelledByBuyer event', async () => {
        await expect(
          escrow
            .connect(buyer)
            .buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.emit(escrow, 'CancelledByBuyer');
      });

      describe('With a dispute', () => {
        beforeEach(async () => {
          await escrow
            .connect(buyer)
            .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');
        });

        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, 0, 0, winnerBalance.add(BigNumber.from('3'))] // seller gets 1 MATIC from the dispute fee + escrowed values + fee
            );
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createNativeEscrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000'
                );
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
            });

            it('Should return the dispute fee to the seller', async () => {
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    constants.AddressZero,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
            });
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [escrowBalance, DISPUTE_FEE, 0, 1003]
            );
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createNativeEscrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000'
                );
            });

            it('Should return the dispute fee to the buyer', async () => {
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    constants.AddressZero,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
            });
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, constants.AddressZero, '1000')
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

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createNativeEscrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000'
                );
            });

            it('Should return the dispute fee to the winner', async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    constants.AddressZero,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
              );
              expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
            });
          });
        });
      });

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createNativeEscrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '1013'
            }
          );
        });

        it('Should transfer funds to the seller', async () => {
          await expect(
            escrow
              .connect(buyer)
              .buyerCancel(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000'
              )
          ).to.changeEtherBalances([escrow, seller], [-1013, 1013]);
        });
      });

      describe('With instant escrow', () => {
        beforeEach(async () => {
          await seller.sendTransaction({
            to: escrow.address,
            value: '1003'
          });
          await escrow.createNativeEscrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            true
          );
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
        });

        it('Should return the balance', async () => {
          await escrow
            .connect(buyer)
            .buyerCancel(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              constants.AddressZero,
              '1000'
            );
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
        });
      });
    });

    describe('ERC20 token', () => {
      beforeEach(async () => {
        await escrow.createERC20Escrow(
          orderID,
          buyer.address,
          erc20.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false
        );
      });

      it('Should fail with a not found escrow', async () => {
        await expect(
          escrow
            .connect(buyer)
            .buyerCancel(
              ethers.utils.formatBytes32String('10000'),
              buyer.address,
              erc20.address,
              '1000'
            )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than buyer', async () => {
        await expect(
          escrow.buyerCancel(orderID, buyer.address, erc20.address, '1000')
        ).to.be.revertedWith('Must be buyer');
      });

      it('Should transfer funds to the seller', async () => {
        await expect(
          escrow.connect(buyer).buyerCancel(orderID, buyer.address, erc20.address, '1000')
        ).to.changeTokenBalances(erc20, [escrow, seller], [-1003, 1003]);
      });

      it('Should emit the CancelledByBuyer event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        await expect(
          escrow.connect(buyer).buyerCancel(orderID, buyer.address, erc20.address, '1000')
        )
          .to.emit(escrow, 'CancelledByBuyer')
          .withArgs(tradeHash);
      });

      describe('With a dispute', () => {
        beforeEach(async () => {
          await escrow
            .connect(buyer)
            .markAsPaid(orderID, buyer.address, erc20.address, '1000');
        });

        describe('When only the seller paid', () => {
          it('Should return the dispute fee to the seller', async () => {
            await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
              value: DISPUTE_FEE
            });
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
            );
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createERC20Escrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000'
                );
            });

            it('Should return the dispute fee to the seller', async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                {
                  value: DISPUTE_FEE
                }
              );
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    erc20.address,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-1), 0, 0, DISPUTE_FEE]
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
            });
          });
        });

        describe('When only the buyer paid', () => {
          it('Should return the dispute fee to the buyer', async () => {
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
            );
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createERC20Escrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000'
                );
            });

            it('Should return the dispute fee to the buyer', async () => {
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    erc20.address,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
            });
          });
        });

        describe('When both parts paid', () => {
          it('Should return the dispute fee to the winner', async () => {
            await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
              value: DISPUTE_FEE
            });
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            await expect(
              escrow
                .connect(buyer)
                .buyerCancel(orderID, buyer.address, erc20.address, '1000')
            ).to.changeEtherBalances(
              [escrow, buyer, feeRecipient, seller],
              [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
            );
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await seller.sendTransaction({
                to: escrow.address,
                value: '1003'
              });
              await escrow.createERC20Escrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000'
                );
            });

            it('Should return the dispute fee to the winner', async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                {
                  value: DISPUTE_FEE
                }
              );
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
              await expect(
                escrow
                  .connect(buyer)
                  .buyerCancel(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    erc20.address,
                    '1000'
                  )
              ).to.changeEtherBalances(
                [escrow, buyer, feeRecipient, seller],
                [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
              );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
            });
          });
        });
      });

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createERC20Escrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false
          );
        });

        it('Should transfer funds to the seller', async () => {
          await expect(
            escrow
              .connect(buyer)
              .buyerCancel(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000'
              )
          ).to.changeTokenBalances(erc20, [escrow, seller], [-1013, 1013]);
        });
      });

      describe('With instant escrow', () => {
        beforeEach(async () => {
          await seller.sendTransaction({
            to: escrow.address,
            value: '1003'
          });
          await escrow.createERC20Escrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            true
          );
          expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
        });

        it('Should return the balance', async () => {
          await escrow
            .connect(buyer)
            .buyerCancel(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              erc20.address,
              '1000'
            );
          expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
        });
      });
    });
  });

  describe('Seller cancel', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.createNativeEscrow(
          orderID,
          buyer.address,
          '1000',
          constants.AddressZero,
          15 * 60, // 15 minutes
          false,
          {
            value: '1003'
          }
        );
      });

      it('Should fail with a not found escrow', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(
          escrow.sellerCancel(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            constants.AddressZero,
            '1000'
          )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than buyer', async () => {
        await expect(
          escrow
            .connect(buyer)
            .sellerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('Must be seller');
      });

      it('Should not transfer funds if the seller cannot cancel', async () => {
        await expect(
          escrow.sellerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.changeEtherBalances([escrow, seller], [0, 0]);
      });

      it('Should transfer funds to the seller', async () => {
        await time.increaseTo((await time.latest()) + 15 * 60);
        await expect(
          escrow.sellerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [-1003, 1003, 0, 0]
        );
      });

      it('Should emit the CancelledBySeller event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(
          escrow.sellerCancel(orderID, buyer.address, constants.AddressZero, '1000')
        )
          .to.emit(escrow, 'CancelledBySeller')
          .withArgs(tradeHash);
      });

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createNativeEscrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false,
            {
              value: '1013'
            }
          );
        });

        it('Should transfer funds to the seller', async () => {
          await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
          await expect(
            escrow.sellerCancel(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              constants.AddressZero,
              '1000'
            )
          ).to.changeEtherBalances(
            [escrow, seller, buyer, feeRecipient, partner],
            [-1013, 1013, 0, 0, 0]
          );
        });
      });

      describe('With instant escrow', () => {
        beforeEach(async () => {
          await seller.sendTransaction({
            to: escrow.address,
            value: '1003'
          });
          await escrow.createNativeEscrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            '1000',
            constants.AddressZero,
            15 * 60, // 15 minutes
            true
          );
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
        });

        it('Should return the balance', async () => {
          await time.increaseTo((await time.latest()) + 15 * 60);
          await escrow.sellerCancel(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            constants.AddressZero,
            '1000'
          );
          expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
        });
      });
    });

    describe('ERC20 token', () => {
      beforeEach(async () => {
        await escrow.createERC20Escrow(
          orderID,
          buyer.address,
          erc20.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false
        );
      });

      it('Should fail with a not found escrow', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(
          escrow.sellerCancel(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            erc20.address,
            '1000'
          )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });

      it('Should revert with an address different than seller', async () => {
        await expect(
          escrow
            .connect(buyer)
            .sellerCancel(orderID, buyer.address, erc20.address, '1000')
        ).to.be.revertedWith('Must be seller');
      });

      it('Should not transfer funds if the seller cannot cancel', async () => {
        await expect(
          escrow.sellerCancel(orderID, buyer.address, erc20.address, '1000')
        ).to.changeTokenBalances(erc20, [escrow, seller], [0, 0]);
      });

      it('Should transfer funds to the seller', async () => {
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(
          escrow.sellerCancel(orderID, buyer.address, erc20.address, '1000')
        ).to.changeTokenBalances(
          erc20,
          [escrow, seller, buyer, feeRecipient],
          [-1003, 1003, 0, 0]
        );
      });

      it('Should emit the CancelledBySeller event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: erc20.address,
          amount: '1000'
        });
        await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
        await expect(escrow.sellerCancel(orderID, buyer.address, erc20.address, '1000'))
          .to.emit(escrow, 'CancelledBySeller')
          .withArgs(tradeHash);
      });

      describe('With partner fee', () => {
        beforeEach(async () => {
          await deployer.updatePartnerFeeBps([partner.address], [100]);
          await escrow.createERC20Escrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000',
            partner.address,
            ONE_DAY_IN_SECS,
            false
          );
        });

        it('Should transfer funds to the seller', async () => {
          await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
          await expect(
            escrow.sellerCancel(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              erc20.address,
              '1000'
            )
          ).to.changeTokenBalances(
            erc20,
            [escrow, seller, buyer, feeRecipient, partner],
            [-1013, 1013, 0, 0, 0]
          );
        });
      });

      describe('With instant escrow', () => {
        beforeEach(async () => {
          await erc20.transfer(escrow.address, '1003');
          await escrow.createERC20Escrow(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000',
            constants.AddressZero,
            ONE_DAY_IN_SECS,
            true
          );
          expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
        });

        it('Should return the balance', async () => {
          await time.increaseTo((await time.latest()) + ONE_DAY_IN_SECS);
          await escrow.sellerCancel(
            ethers.utils.formatBytes32String('2'),
            buyer.address,
            erc20.address,
            '1000'
          );
          expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
        });
      });
    });
  });

  describe('Mark as paid', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await escrow.createNativeEscrow(
          orderID,
          buyer.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false,
          {
            value: '1003'
          }
        );
      });

      it('Should revert with an address different than buyer', async () => {
        await expect(
          escrow.markAsPaid(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('Must be buyer');
      });

      it('Should set sellerCanCancelAfter as 1', async () => {
        await escrow
          .connect(buyer)
          .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');

        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        const [, sellerCanCancelAfter] = await escrow.escrows(tradeHash);
        expect(sellerCanCancelAfter).to.equal(1);
      });

      it('Should emit the SellerCancelDisabled event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await expect(
          escrow
            .connect(buyer)
            .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000')
        )
          .to.emit(escrow, 'SellerCancelDisabled')
          .withArgs(tradeHash);
      });

      it('Should fail with a not found escrow', async () => {
        await expect(
          escrow
            .connect(buyer)
            .markAsPaid(
              ethers.utils.formatBytes32String('10000'),
              buyer.address,
              constants.AddressZero,
              '1000'
            )
        ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
      });
    });
  });

  describe('Open dispute', () => {
    beforeEach(async () => {
      await escrow.createNativeEscrow(
        orderID,
        buyer.address,
        '1000',
        constants.AddressZero,
        ONE_DAY_IN_SECS,
        false,
        { value: '1003' }
      );
    });

    it('Should fail with a not found escrow', async () => {
      await expect(
        escrow
          .connect(buyer)
          .openDispute(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            constants.AddressZero,
            '1000'
          )
      ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
    });

    it('Should revert with an address different than seller or buyer', async () => {
      const [, , otherAccount] = await ethers.getSigners();
      await expect(
        escrow
          .connect(otherAccount)
          .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          })
      ).to.be.revertedWith('Must be seller or buyer');
    });

    describe('As the seller', () => {
      beforeEach(async () => {
        await escrow
          .connect(buyer)
          .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');
      });

      it('Should revert if there is no dispute payment', async () => {
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if there is not enough for the dispute payment', async () => {
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: '1000'
          })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert with more than the dispute fee value', async () => {
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE.add(BigNumber.from('1'))
          })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if the user already paid', async () => {
        await escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
          value: DISPUTE_FEE
        });
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          })
        ).to.be.revertedWith('This address already paid for the dispute');
      });

      it('Should mark the dispute as paid by the seller', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
          value: DISPUTE_FEE
        });
        expect(await escrow.disputePayments(tradeHash, buyer.address)).to.be.false;
        expect(await escrow.disputePayments(tradeHash, seller.address)).to.be.true;
      });

      it('Should transfer 1 MATIC to the contract', async () => {
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          })
        ).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [DISPUTE_FEE, DISPUTE_FEE.mul(-1), 0, 0]
        );
      });

      it('Should return true', async () => {
        await escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
          value: DISPUTE_FEE
        });
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        const [, , , dispute] = await escrow.escrows(tradeHash);
        expect(dispute).to.true;
      });

      it('Should emit an DisputeOpened event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          })
        )
          .to.emit(escrow, 'DisputeOpened')
          .withArgs(tradeHash, seller.address);
      });
    });

    describe('As the buyer', () => {
      beforeEach(async () => {
        await escrow
          .connect(buyer)
          .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');
      });

      it('Should revert if there is no dispute payment', async () => {
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000')
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if there is not enough for the dispute payment', async () => {
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
              value: '1000'
            })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert with more than the dispute fee value', async () => {
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
              value: DISPUTE_FEE.add(BigNumber.from('1'))
            })
        ).to.be.revertedWith('To open a dispute, you must pay 1 MATIC');
      });

      it('Should revert if the user already paid', async () => {
        await escrow
          .connect(buyer)
          .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          });
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
              value: DISPUTE_FEE
            })
        ).to.be.revertedWith('This address already paid for the dispute');
      });

      it('Should mark the dispute as paid by the buyer', async () => {
        await escrow
          .connect(buyer)
          .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          });
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });

        expect(await escrow.disputePayments(tradeHash, buyer.address)).to.be.true;
        expect(await escrow.disputePayments(tradeHash, seller.address)).to.be.false;
      });

      it('Should transfer 1 MATIC to the contract', async () => {
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
              value: DISPUTE_FEE
            })
        ).to.changeEtherBalances(
          [escrow, seller, buyer, feeRecipient],
          [DISPUTE_FEE, 0, DISPUTE_FEE.mul(-1), 0]
        );
      });

      it('Should return true', async () => {
        await escrow
          .connect(buyer)
          .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          });
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        const [, , , dispute] = await escrow.escrows(tradeHash);
        expect(dispute).to.true;
      });

      it('Should emit an DisputeOpened event', async () => {
        const tradeHash = generateTradeHash({
          orderID,
          sellerAddress: seller.address,
          buyerAddress: buyer.address,
          tokenAddress: constants.AddressZero,
          amount: '1000'
        });
        await expect(
          escrow
            .connect(buyer)
            .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
              value: DISPUTE_FEE
            })
        )
          .to.emit(escrow, 'DisputeOpened')
          .withArgs(tradeHash, buyer.address);
      });
    });

    describe('Native token', () => {
      it('Should revert with if the buyer did not mark as paid', async () => {
        await expect(
          escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
            value: DISPUTE_FEE
          })
        ).to.be.revertedWith('Cannot open a dispute yet');
      });
    });

    describe('ERC20 token', () => {
      it('Should revert with if the buyer did not mark as paid', async () => {
        await escrow.createERC20Escrow(
          orderID,
          buyer.address,
          erc20.address,
          '1000',
          constants.AddressZero,
          ONE_DAY_IN_SECS,
          false
        );
        await expect(
          escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
            value: DISPUTE_FEE
          })
        ).to.be.revertedWith('Cannot open a dispute yet');
      });
    });
  });

  describe('Resolve dispute', () => {
    beforeEach(async () => {
      await escrow.createNativeEscrow(
        orderID,
        buyer.address,
        '1000',
        constants.AddressZero,
        ONE_DAY_IN_SECS,
        false,
        { value: '1003' }
      );
      await escrow
        .connect(buyer)
        .markAsPaid(orderID, buyer.address, constants.AddressZero, '1000');
    });

    it('Should revert with an address different than arbitrator', async () => {
      await expect(
        escrow.resolveDispute(
          orderID,
          buyer.address,
          constants.AddressZero,
          '1000',
          arbitrator.address
        )
      ).to.be.revertedWith('Must be arbitrator');
    });

    it('Should revert if the dispute is not open', async () => {
      await expect(
        escrow
          .connect(arbitrator)
          .resolveDispute(
            orderID,
            buyer.address,
            constants.AddressZero,
            '1000',
            seller.address
          )
      ).to.be.revertedWith('Dispute is not open');
    });

    it('Should revert with a wrong winner', async () => {
      await escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
        value: DISPUTE_FEE
      });
      await expect(
        escrow
          .connect(arbitrator)
          .resolveDispute(
            orderID,
            buyer.address,
            constants.AddressZero,
            '1000',
            arbitrator.address
          )
      ).to.be.revertedWith('Winner must be seller or buyer');
    });

    it('Should emit an DisputeResolved event', async () => {
      await escrow.openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
        value: DISPUTE_FEE
      });
      const tradeHash = generateTradeHash({
        orderID,
        sellerAddress: seller.address,
        buyerAddress: buyer.address,
        tokenAddress: constants.AddressZero,
        amount: '1000'
      });
      await expect(
        escrow
          .connect(arbitrator)
          .resolveDispute(
            orderID,
            buyer.address,
            constants.AddressZero,
            '1000',
            seller.address
          )
      )
        .to.emit(escrow, 'DisputeResolved')
        .withArgs(tradeHash, seller.address);
    });

    it('Should fail with a not found escrow', async () => {
      await expect(
        escrow
          .connect(arbitrator)
          .resolveDispute(
            ethers.utils.formatBytes32String('10000'),
            buyer.address,
            constants.AddressZero,
            '1000',
            seller.address
          )
      ).to.be.revertedWithCustomError(escrow, 'EscrowNotFound');
    });

    describe('Valid resolutions', () => {
      describe('Native token', () => {
        describe('When only the seller paid', () => {
          beforeEach(async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    seller.address
                  )
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, winnerBalance.add(3), 0, 0]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    buyer.address
                  )
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, 0, winnerBalance, 3]
              );
            });
          });
        });

        describe('When only the buyer paid', () => {
          beforeEach(async () => {
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    seller.address
                  )
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, winnerBalance.add(3), 0, 0]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    buyer.address
                  )
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [escrowBalance, 0, winnerBalance, 3]
              );
            });
          });
        });

        describe('When both parts paid', () => {
          beforeEach(async () => {
            await escrow.openDispute(
              orderID,
              buyer.address,
              constants.AddressZero,
              '1000',
              { value: DISPUTE_FEE }
            );
            await escrow
              .connect(buyer)
              .openDispute(orderID, buyer.address, constants.AddressZero, '1000', {
                value: DISPUTE_FEE
              });
          });

          describe('With the seller as winner', () => {
            it('Should return the tokens to the seller', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    seller.address
                  )
              ).to.changeEtherBalances(
                [escrow, seller, buyer, feeRecipient],
                [
                  escrowBalance.add(DISPUTE_FEE.mul(-1)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1003)
                  winnerBalance.add(3),
                  0,
                  DISPUTE_FEE
                ]
              );
            });
          });

          describe('With the buyer as winner', () => {
            it('Should return the tokens to the buyer', async () => {
              await expect(
                escrow
                  .connect(arbitrator)
                  .resolveDispute(
                    orderID,
                    buyer.address,
                    constants.AddressZero,
                    '1000',
                    buyer.address
                  )
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

        describe('With partner fee', () => {
          beforeEach(async () => {
            await deployer.updatePartnerFeeBps([partner.address], [100]);
            await escrow.createNativeEscrow(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              '1000',
              partner.address,
              ONE_DAY_IN_SECS,
              false,
              { value: '1013' }
            );
            await escrow
              .connect(buyer)
              .markAsPaid(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000'
              );
          });

          describe('When only the seller paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [escrowBalance.sub(BigNumber.from(10)), winnerBalance.add(13), 0, 0, 0] // balance has 10 wei more because of the partner fee
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [escrowBalance.sub(BigNumber.from(10)), 0, winnerBalance, 3, 10] // balance has 10 wei more because of the partner fee
                );
              });
            });
          });

          describe('When only the buyer paid', () => {
            beforeEach(async () => {
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [escrowBalance.sub(BigNumber.from(10)), winnerBalance.add(13), 0, 0, 0] // balance has 10 wei more because of the partner fee
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [escrowBalance.sub(BigNumber.from(10)), 0, winnerBalance, 3, 10] // balance has 10 wei more because of the partner fee
                );
              });
            });
          });

          describe('When both parts paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [
                    escrowBalance.add(DISPUTE_FEE.mul(-1)).sub(BigNumber.from(10)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1003)
                    winnerBalance.add(13),
                    0,
                    DISPUTE_FEE
                  ]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [
                    escrowBalance.add(DISPUTE_FEE.mul(-1)).sub(BigNumber.from(10)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1013)
                    0,
                    winnerBalance,
                    DISPUTE_FEE.add(BigNumber.from(3)) // arbitration fee + escrow fee
                  ]
                );
              });
            });
          });
        });

        describe('With instant escrow', () => {
          beforeEach(async () => {
            await seller.sendTransaction({
              to: escrow.address,
              value: '1003'
            });
            await escrow.createNativeEscrow(
              ethers.utils.formatBytes32String('2'),
              buyer.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              true
            );
            await escrow
              .connect(buyer)
              .markAsPaid(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000'
              );
            expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('1003');
          });

          describe('When only the seller paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the escrow', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0] // dispute fee return the seller
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [escrowBalance, 0, winnerBalance, 3]
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal(
                  '1003'
                );
              });
            });
          });

          describe('When only the buyer paid', () => {
            beforeEach(async () => {
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [escrowBalance, 0, winnerBalance, 3]
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal(
                  '1003'
                );
              });
            });
          });

          describe('When both parts paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                constants.AddressZero,
                '1000',
                { value: DISPUTE_FEE }
              );
              await escrow
                .connect(buyer)
                .openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  constants.AddressZero,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-2), DISPUTE_FEE, 0, DISPUTE_FEE]
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal('0');
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      ethers.utils.formatBytes32String('2'),
                      buyer.address,
                      constants.AddressZero,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [
                    escrowBalance.add(DISPUTE_FEE.mul(-1)), // seller dispute fee (1 MATIC)+ buyer dispute fee (1 MATIC) + escrowed funds (1003)
                    0,
                    winnerBalance,
                    DISPUTE_FEE.add(BigNumber.from(3)) // arbitration fee + escrow fee
                  ]
                );
                expect(await escrow.balancesInUse(constants.AddressZero)).to.equal(
                  '1003'
                );
              });
            });
          });
        });
      });

      describe('ERC20 token', () => {
        describe('Without partner fee', () => {
          beforeEach(async () => {
            await escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '1000',
              constants.AddressZero,
              ONE_DAY_IN_SECS,
              false
            );
            await escrow
              .connect(buyer)
              .markAsPaid(orderID, buyer.address, erc20.address, '1000');
          });

          describe('When only the seller paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 1003, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 0, 1000, 3]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
                );
              });
            });
          });

          describe('When only the buyer paid', () => {
            beforeEach(async () => {
              await escrow
                .connect(buyer)
                .openDispute(orderID, buyer.address, erc20.address, '1000', {
                  value: DISPUTE_FEE
                });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1003, 1003, 0, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 0, 1000, 3]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
                );
              });
            });
          });

          describe('When both parts paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
              await escrow
                .connect(buyer)
                .openDispute(orderID, buyer.address, erc20.address, '1000', {
                  value: DISPUTE_FEE
                });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 1003, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-2), DISPUTE_FEE, 0, DISPUTE_FEE]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient],
                  [-1003, 0, 1000, 3]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient],
                  [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
                );
              });
            });
          });

          describe('With instant escrow', () => {
            beforeEach(async () => {
              await erc20.transfer;
              await escrow.createERC20Escrow(
                ethers.utils.formatBytes32String('2'),
                buyer.address,
                erc20.address,
                '1000',
                constants.AddressZero,
                ONE_DAY_IN_SECS,
                true
              );
              await escrow
                .connect(buyer)
                .markAsPaid(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000'
                );
              expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
            });

            describe('When only the seller paid', () => {
              beforeEach(async () => {
                await escrow.openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
              });

              describe('With the seller as winner', () => {
                it('Should return the tokens to the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient],
                    [0, 0, 0, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });

                it('Should return the fee to the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });
              });

              describe('With the buyer as winner', () => {
                it('Should return the tokens to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient],
                    [-1003, 0, 1000, 3]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });

                it('Should return the fee to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });
              });
            });

            describe('When only the buyer paid', () => {
              beforeEach(async () => {
                await escrow
                  .connect(buyer)
                  .openDispute(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    erc20.address,
                    '1000',
                    {
                      value: DISPUTE_FEE
                    }
                  );
              });

              describe('With the seller as winner', () => {
                it('Should return the tokens to the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient, partner],
                    [0, 0, 0, 0, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });

                it('Should return the fee to the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });
              });

              describe('With the buyer as winner', () => {
                it('Should return the tokens to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient],
                    [-1003, 0, 1000, 3]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });

                it('Should return the fee to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });
              });
            });

            describe('When both parts paid', () => {
              beforeEach(async () => {
                await escrow.openDispute(
                  ethers.utils.formatBytes32String('2'),
                  buyer.address,
                  erc20.address,
                  '1000',
                  {
                    value: DISPUTE_FEE
                  }
                );
                await escrow
                  .connect(buyer)
                  .openDispute(
                    ethers.utils.formatBytes32String('2'),
                    buyer.address,
                    erc20.address,
                    '1000',
                    {
                      value: DISPUTE_FEE
                    }
                  );
              });

              describe('With the seller as winner', () => {
                it('Should keep the tokens in the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient],
                    [0, 0, 0, 0]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });

                it('Should return the fee to the seller', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        seller.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-2), DISPUTE_FEE, 0, DISPUTE_FEE]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('0');
                });
              });

              describe('With the buyer as winner', () => {
                it('Should return the tokens to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeTokenBalances(
                    erc20,
                    [escrow, seller, buyer, feeRecipient],
                    [-1003, 0, 1000, 3]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });

                it('Should return the fee to the buyer', async () => {
                  await expect(
                    escrow
                      .connect(arbitrator)
                      .resolveDispute(
                        ethers.utils.formatBytes32String('2'),
                        buyer.address,
                        erc20.address,
                        '1000',
                        buyer.address
                      )
                  ).to.changeEtherBalances(
                    [escrow, seller, buyer, feeRecipient],
                    [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE]
                  );
                  expect(await escrow.balancesInUse(erc20.address)).to.equal('1003');
                });
              });
            });
          });
        });

        describe('With partner fee', () => {
          beforeEach(async () => {
            await deployer.updatePartnerFeeBps([partner.address], [100]);
            await escrow.createERC20Escrow(
              orderID,
              buyer.address,
              erc20.address,
              '1000',
              partner.address,
              ONE_DAY_IN_SECS,
              false
            );
            await escrow
              .connect(buyer)
              .markAsPaid(orderID, buyer.address, erc20.address, '1000');
          });

          describe('When only the seller paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 1013, 0, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0, 0]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 0, 1000, 3, 10]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0, 0]
                );
              });
            });
          });

          describe('When only the buyer paid', () => {
            beforeEach(async () => {
              await escrow
                .connect(buyer)
                .openDispute(orderID, buyer.address, erc20.address, '1000', {
                  value: DISPUTE_FEE
                });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 1013, 0, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-1), DISPUTE_FEE, 0, 0, 0]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 0, 1000, 3, 10]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-1), 0, DISPUTE_FEE, 0, 0]
                );
              });
            });
          });

          describe('When both parts paid', () => {
            beforeEach(async () => {
              await escrow.openDispute(orderID, buyer.address, erc20.address, '1000', {
                value: DISPUTE_FEE
              });
              await escrow
                .connect(buyer)
                .openDispute(orderID, buyer.address, erc20.address, '1000', {
                  value: DISPUTE_FEE
                });
            });

            describe('With the seller as winner', () => {
              it('Should return the tokens to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 1013, 0, 0, 0]
                );
              });

              it('Should return the fee to the seller', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      seller.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-2), DISPUTE_FEE, 0, DISPUTE_FEE, 0]
                );
              });
            });

            describe('With the buyer as winner', () => {
              it('Should return the tokens to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeTokenBalances(
                  erc20,
                  [escrow, seller, buyer, feeRecipient, partner],
                  [-1013, 0, 1000, 3, 10]
                );
              });

              it('Should return the fee to the buyer', async () => {
                await expect(
                  escrow
                    .connect(arbitrator)
                    .resolveDispute(
                      orderID,
                      buyer.address,
                      erc20.address,
                      '1000',
                      buyer.address
                    )
                ).to.changeEtherBalances(
                  [escrow, seller, buyer, feeRecipient, partner],
                  [DISPUTE_FEE.mul(-2), 0, DISPUTE_FEE, DISPUTE_FEE, 0]
                );
              });
            });
          });
        });
      });
    });
  });

  describe('Withdraw', () => {
    describe('Native token', () => {
      beforeEach(async () => {
        await seller.sendTransaction({
          to: escrow.address,
          value: '1000'
        });
      });

      it('Should revert with wrong amount', async () => {
        await expect(
          escrow.withdrawBalance(constants.AddressZero, '1001')
        ).to.be.revertedWith('Not enough tokens in escrow');
      });

      it('Should update the balances', async () => {
        await escrow.withdrawBalance(constants.AddressZero, '599');
        expect(await escrow.balancesInUse(constants.AddressZero)).to.equal(0);
      });

      it('Should transfer the tokens', async () => {
        await expect(
          escrow.withdrawBalance(constants.AddressZero, '599')
        ).to.changeEtherBalances([escrow, seller], [-599, 599]);
      });
    });

    describe('ERC20 token', () => {
      beforeEach(async () => {
        await erc20.transfer(escrow.address, '1000');
      });

      it('Should revert with wrong amount', async () => {
        await expect(escrow.withdrawBalance(erc20.address, '1001')).to.be.revertedWith(
          'Not enough tokens in escrow'
        );
      });

      it('Should update the balances', async () => {
        await escrow.withdrawBalance(erc20.address, '599');
        expect(await escrow.balancesInUse(erc20.address)).to.equal(0);
      });

      it('Should transfer the tokens', async () => {
        await expect(escrow.withdrawBalance(erc20.address, '599')).to.changeTokenBalances(
          erc20,
          [escrow, seller],
          [-599, 599]
        );
      });
    });
  });

  it('Should return a version recipient', async () => {
    expect(await escrow.versionRecipient()).to.equal('1.0');
  });
});
