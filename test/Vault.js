/* eslint-env mocha */
/* eslint-disable no-await-in-loop */
const TestRPC = require('ethereumjs-testrpc');
const Web3 = require('web3');
const chai = require('chai');
const liquidpledging = require('../index.js');
const lpData = require('../build/LiquidPledgingMock.sol');
const EternalStorage = require('../js/eternalStorage');
const PledgeAdmins = require('../js/pledgeAdmins');
const assertFail = require('./helpers/assertFail');

const LiquidPledging = liquidpledging.LiquidPledgingMock;
const LiquidPledgingState = liquidpledging.LiquidPledgingState;
const Vault = liquidpledging.LPVault;
const assert = chai.assert;

describe('Vault test', function () {
  this.timeout(0);

  let testrpc;
  let web3;
  let accounts;
  let liquidPledging;
  let liquidPledgingState;
  let vault;
  let vaultOwner;
  let escapeHatchCaller;
  let escapeHatchDestination;
  let giver1;
  let adminProject1;

  before(async () => {
    testrpc = TestRPC.server({
      ws: true,
      gasLimit: 6700000,
      total_accounts: 10,
    });

    testrpc.listen(8546, '127.0.0.1');

    web3 = new Web3('ws://localhost:8546');
    accounts = await web3.eth.getAccounts();
    giver1 = accounts[ 1 ];
    adminProject1 = accounts[ 2 ];
    vaultOwner = accounts[ 3 ];
    escapeHatchDestination = accounts[ 4 ];
    escapeHatchCaller = accounts[ 5 ];
  });

  after((done) => {
    testrpc.close();
    done();
  });

  it('Should deploy Vault contract', async function () {
    vault = await Vault.new(web3, escapeHatchCaller, escapeHatchDestination, { from: vaultOwner });
    let storage = await EternalStorage.new(web3, accounts[0], accounts[1]);
    let admins = await PledgeAdmins.new(web3);

    let bytecode = lpData.LiquidPledgingMockByteCode;
    bytecode = bytecode.replace(/__contracts\/PledgeAdmins\.sol:PledgeAdm__/g, admins.$address.slice(2)); // solc library
    bytecode = bytecode.replace(/__:PledgeAdmins_________________________/g, admins.$address.slice(2)); // yarn sol-compile library

    let lp = await new web3.eth.Contract(lpData.LiquidPledgingMockAbi).deploy({
      arguments: [storage.$address, vault.$address, accounts[0], accounts[0]],
      data: bytecode,
    }).send({
      from: accounts[0],
      gas: 6700000,
      gasPrice: 1,
    });

    liquidPledging = new LiquidPledging(web3, lp._address);
    await storage.changeOwnership(liquidPledging.$address);

    await vault.setLiquidPledging(liquidPledging.$address, { from: vaultOwner });
    liquidPledgingState = new LiquidPledgingState(liquidPledging);

    await liquidPledging.addGiver('Giver1', '', 0, '0x0', { from: giver1 });
    await liquidPledging.addProject('Project1', '', adminProject1, 0, 0, '0x0', { from: adminProject1 });

    const nAdmins = await liquidPledging.numberOfPledgeAdmins();
    assert.equal(nAdmins, 2);
  });

  it('Should hold funds from liquidPledging', async function () {
    await liquidPledging.donate(0, 2, { from: giver1, value: 10000 });

    const balance = await web3.eth.getBalance(vault.$address);
    assert.equal(10000, balance);
  });

  it('escapeFunds should fail', async function () {
    // only vaultOwner can escapeFunds
    await assertFail(async () => {
      await vault.escapeFunds(0x0, 1000);
    });

    // can't send more then the balance
    await assertFail(async () => {
      await vault.escapeFunds(0x0, 11000, { from: vaultOwner });
    });
  });

  it('escapeFunds should send funds to escapeHatchDestination', async function () {
    const preBalance = await web3.eth.getBalance(escapeHatchDestination);

    await vault.escapeFunds(0x0, 1000, { from: vaultOwner });

    const vaultBalance = await web3.eth.getBalance(vault.$address);
    assert.equal(9000, vaultBalance);

    const expected = web3.utils.toBN(preBalance).add(web3.utils.toBN('1000'));
    const postBalance = await web3.eth.getBalance(escapeHatchDestination);

    assert.equal(expected, postBalance);
  });
});

