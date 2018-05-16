import { delay } from 'redux-saga';
import { cloneableGenerator, createMockTask } from 'redux-saga/utils';
import { take, race, fork, call, cancel, apply, cancelled, put, select } from 'redux-saga/effects';
import { getAllRates, getOrderStatus, postOrder } from 'api/bity';
import shapeshift from 'api/shapeshift';
import { configuredStore } from 'redux/store';
import { TypeKeys as TransactionTypeKeys } from 'redux/transaction';
import { TypeKeys as WalletTypeKeys } from 'redux/wallet';
import { showNotification } from 'redux/notifications';
import {
  TypeKeys,
  BityOrderPostResponse,
  BityOrderInput,
  BityOrderOutput,
  BityOrderResponse,
  ShapeshiftOrderResponse
} from './types';
import {
  loadBityRatesSucceededSwap,
  loadShapeshiftRatesSucceededSwap,
  loadShapeshiftRatesFailedSwap,
  loadBityRatesFailedSwap,
  bityOrderCreateFailedSwap,
  bityOrderCreateSucceededSwap,
  bityOrderCreateRequestedSwap,
  changeStepSwap,
  bityOrderStatusRequested,
  bityOrderStatusSucceededSwap,
  orderTimeSwap,
  startOrderTimerSwap,
  startPollBityOrderStatus,
  stopLoadBityRatesSwap,
  stopPollBityOrderStatus,
  startPollShapeshiftOrderStatus,
  shapeshiftOrderStatusRequested,
  shapeshiftOrderStatusSucceededSwap,
  shapeshiftOrderCreateRequestedSwap,
  shapeshiftOrderCreateSucceededSwap,
  shapeshiftOrderCreateFailedSwap,
  stopLoadShapeshiftRatesSwap,
  stopPollShapeshiftOrderStatus,
  stopOrderTimerSwap
} from './actions';
import { State as SwapState, INITIAL_STATE as INITIAL_SWAP_STATE } from './reducers';
import { getSwap, getHasNotifiedRatesFailure } from './selectors';
import {
  configureLiteSendSaga,
  handleConfigureLiteSend,
  pollBityOrderStatus,
  pollBityOrderStatusSaga,
  postBityOrderCreate,
  pollShapeshiftOrderStatus,
  pollShapeshiftOrderStatusSaga,
  shapeshiftOrderTimeRemaining,
  bityOrderTimeRemaining,
  postShapeshiftOrderCreate,
  loadBityRates,
  loadShapeshiftRates,
  handleBityRates,
  handleShapeshiftRates,
  ORDER_TIMEOUT_MESSAGE,
  ORDER_RECEIVED_MESSAGE,
  SHAPESHIFT_TIMEOUT,
  POLLING_CYCLE
} from './sagas';

configuredStore.getState();

//#region Lite Send
describe('swap: Sagas (Lite Send)', () => {
  describe('Testing handle configure lite send', () => {
    const generators = {
      original: cloneableGenerator(handleConfigureLiteSend)()
    };
    const { original } = generators;

    it('forks a configureLiteSend saga', () => {
      const expectedYield = fork(configureLiteSendSaga);
      expect(original.next().value).toEqual(expectedYield);
    });

    it('races between three conditions, either the transaction state is reset, the user navigated away from the page, or bitty/shapeshift polling as finished', () => {
      const mockedTask = createMockTask();
      const expectedYield = race({
        transactionReset: take(TransactionTypeKeys.RESET_REQUESTED),
        userNavigatedAway: take(WalletTypeKeys.WALLET_RESET),
        bityPollingFinished: take(TypeKeys.SWAP_STOP_POLL_BITY_ORDER_STATUS),
        shapeshiftPollingFinished: take(TypeKeys.SWAP_STOP_POLL_SHAPESHIFT_ORDER_STATUS)
      });

      expect(original.next(mockedTask).value).toEqual(expectedYield);
    });
  });
});
//#endregion Lite Send

//#region Orders
describe('swap: Sagas (Orders)', () => {
  const ONE_SECOND = 1000;
  const TEN_SECONDS = ONE_SECOND * 10;
  const ELEVEN_SECONDS = ONE_SECOND * 11;

  const orderInput: BityOrderInput = {
    amount: 'amount',
    currency: 'currency',
    reference: 'reference',
    status: 'status'
  };
  const orderOutput: BityOrderOutput = {
    amount: 'amount',
    currency: 'currency',
    reference: 'reference',
    status: 'status'
  };

  describe('pollBityOrderStatus*', () => {
    const data = {} as any;
    data.gen = cloneableGenerator(pollBityOrderStatus)();
    const fakeSwap: SwapState = {
      ...INITIAL_SWAP_STATE,
      orderId: '1'
    };
    const orderResponse: BityOrderResponse = {
      input: orderInput,
      output: orderOutput,
      status: 'status'
    };
    const cancelledSwap = 'CANC';
    const successStatus = {
      error: null,
      data: orderResponse
    };
    const errorStatus = {
      error: true,
      msg: 'error message'
    };
    let random: () => number;

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should put bityOrderStatusRequestedSwap', () => {
      expect(data.gen.next(fakeSwap).value).toEqual(put(bityOrderStatusRequested()));
    });

    it('should call getOrderStatus with swap.orderId', () => {
      expect(data.gen.next().value).toEqual(call(getOrderStatus, fakeSwap.orderId));
    });

    it('should put showNotfication on error', () => {
      data.clone = data.gen.clone();
      expect(data.clone.next(errorStatus).value).toEqual(
        put(showNotification('danger', `Bity Error: ${errorStatus.msg}`, TEN_SECONDS))
      );
    });

    it('should put orderStatusSucceededSwap', () => {
      expect(data.gen.next(successStatus).value).toEqual(
        put(bityOrderStatusSucceededSwap(successStatus.data))
      );
    });

    it('should call delay for 5 seconds', () => {
      expect(data.gen.next().value).toEqual(call(delay, ONE_SECOND * 5));
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should break loop if swap is cancelled', () => {
      data.clone2 = data.gen.clone();
      expect(data.clone2.next(cancelledSwap).value).toEqual(cancelled());
      expect(data.clone2.next().done).toEqual(true);
    });

    it('should restart loop', () => {
      expect(data.gen.next(fakeSwap).value).toEqual(put(bityOrderStatusRequested()));
    });
  });

  describe('pollShapeshiftOrderStatus*', () => {
    const data = {} as any;
    data.gen = cloneableGenerator(pollShapeshiftOrderStatus)();
    const fakeSwap: SwapState = {
      ...INITIAL_SWAP_STATE,
      orderId: '1'
    };
    const cancelledSwap = 'CANC';
    const successStatus = {
      status: 'complete',
      transaction: '0x'
    };
    const errorStatus = {
      error: 'Shapeshift error',
      status: 'failed'
    };
    let random: () => number;

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should put shapeshiftOrderStatusRequestedSwap', () => {
      expect(data.gen.next(fakeSwap).value).toEqual(put(shapeshiftOrderStatusRequested()));
    });

    it('should apply shapeshift.checkStatus with swap.paymentAddress', () => {
      expect(data.gen.next().value).toEqual(
        apply(shapeshift, shapeshift.checkStatus, [fakeSwap.paymentAddress])
      );
    });

    it('should put showNotfication on error', () => {
      data.clone = data.gen.clone();
      expect(data.clone.next(errorStatus).value).toEqual(
        put(showNotification('danger', `Shapeshift Error: ${errorStatus.error}`, Infinity))
      );
    });

    it('should put shapeshiftOrderStatusSucceededSwap', () => {
      expect(data.gen.next(successStatus).value).toEqual(
        put(shapeshiftOrderStatusSucceededSwap(successStatus))
      );
    });

    it('should call delay for 5 seconds', () => {
      expect(data.gen.next().value).toEqual(call(delay, ONE_SECOND * 5));
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should break loop if swap is cancelled', () => {
      data.clone2 = data.gen.clone();
      expect(data.clone2.next(cancelledSwap).value).toEqual(cancelled());
      expect(data.clone2.next().done).toEqual(true);
    });

    it('should restart loop', () => {
      expect(data.gen.next(fakeSwap).value).toEqual(put(shapeshiftOrderStatusRequested()));
    });
  });

  describe('pollBityOrderStatusSaga*', () => {
    const data = {} as any;
    data.gen = cloneableGenerator(pollBityOrderStatusSaga)();
    const mockedTask = createMockTask();

    it('should take SWAP_START_POLL_BITY_ORDER_STATUS', () => {
      expect(data.gen.next().value).toEqual(take(TypeKeys.SWAP_START_POLL_BITY_ORDER_STATUS));
    });

    it('should be done if order status is false', () => {
      data.clone = data.gen.clone();
      expect(data.clone.next(false).done).toEqual(true);
    });

    it('should fork pollBityOrderStatus', () => {
      expect(data.gen.next(true).value).toEqual(fork(pollBityOrderStatus));
    });

    it('should take SWAP_STOP_POLL_BITY_ORDER_STATUS', () => {
      expect(data.gen.next(mockedTask).value).toEqual(
        take(TypeKeys.SWAP_STOP_POLL_BITY_ORDER_STATUS)
      );
    });

    it('should cancel pollBityOrderStatusTask', () => {
      expect(data.gen.next().value).toEqual(cancel(mockedTask));
    });
  });

  describe('pollShapeshiftOrderStatusSaga*', () => {
    const data = {} as any;
    data.gen = cloneableGenerator(pollShapeshiftOrderStatusSaga)();
    const mockedTask = createMockTask();

    it('should take SWAP_START_POLL_SHAPESHIFT_ORDER_STATUS', () => {
      expect(data.gen.next().value).toEqual(take(TypeKeys.SWAP_START_POLL_SHAPESHIFT_ORDER_STATUS));
    });

    it('should be done if order status is false', () => {
      data.clone = data.gen.clone();
      expect(data.clone.next(false).done).toEqual(true);
    });

    it('should fork pollShapeshiftOrderStatus', () => {
      expect(data.gen.next(true).value).toEqual(fork(pollShapeshiftOrderStatus));
    });

    it('should take SWAP_STOP_POLL_SHAPESHIFT_ORDER_STATUS', () => {
      expect(data.gen.next(mockedTask).value).toEqual(
        take(TypeKeys.SWAP_STOP_POLL_SHAPESHIFT_ORDER_STATUS)
      );
    });

    it('should cancel pollShapeshiftOrderStatusTask', () => {
      expect(data.gen.next().value).toEqual(cancel(mockedTask));
    });
  });

  describe('postBityOrderCreate*', () => {
    const amount = 100;
    const destinationAddress = '0x0';
    const pair = 'BTC_ETH';
    const action = bityOrderCreateRequestedSwap(amount, destinationAddress, pair);
    const orderResp: BityOrderPostResponse = {
      payment_address: '0x0',
      status: 'status',
      input: orderInput,
      output: orderOutput,
      timestamp_created: 'timestamp_created',
      validFor: 10,
      id: '0'
    };
    const successOrder = { error: false, data: orderResp };
    const errorOrder = { error: true, msg: 'error msg' };
    const connectionErrMsg =
      'Connection Error. Please check the developer console for more details and/or contact support';

    const data = {} as any;
    data.gen = cloneableGenerator(postBityOrderCreate)(action);

    let random: () => number;
    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should put stopLoadBityRatesSwap', () => {
      expect(data.gen.next().value).toEqual(put(stopLoadBityRatesSwap()));
    });

    it('should call postOrder', () => {
      data.clone1 = data.gen.clone();
      expect(data.gen.next().value).toEqual(
        call(postOrder, amount, destinationAddress, action.payload.mode, pair)
      );
    });

    it('should put bityOrderCreateSucceededSwap', () => {
      data.clone2 = data.gen.clone();
      expect(data.gen.next(successOrder).value).toEqual(
        put(bityOrderCreateSucceededSwap(successOrder.data))
      );
    });

    it('should put changeStepSwap', () => {
      expect(data.gen.next().value).toEqual(put(changeStepSwap(3)));
    });

    it('should put startOrderTimerSwap', () => {
      expect(data.gen.next().value).toEqual(put(startOrderTimerSwap()));
    });

    it('should put startPollBityOrderStatus', () => {
      expect(data.gen.next().value).toEqual(put(startPollBityOrderStatus()));
    });

    // failure modes
    it('should handle a connection exeception', () => {
      expect(data.clone1.throw().value).toEqual(
        put(showNotification('danger', connectionErrMsg, TEN_SECONDS))
      );
      expect(data.clone1.next().value).toEqual(put(bityOrderCreateFailedSwap()));
      expect(data.clone1.next().done).toEqual(true);
    });

    it('should handle an errored order', () => {
      expect(data.clone2.next(errorOrder).value).toEqual(
        put(showNotification('danger', `Bity Error: ${errorOrder.msg}`, TEN_SECONDS))
      );
      expect(data.clone2.next().value).toEqual(put(bityOrderCreateFailedSwap()));
    });
  });

  describe('postShapeshiftOrderCreate*', () => {
    const amount = 100;
    const withdrawalAddress = '0x0';
    const originKind = 'BAT';
    const destKind = 'ETH';
    const action = shapeshiftOrderCreateRequestedSwap(
      withdrawalAddress,
      originKind,
      destKind,
      amount
    );
    const orderResp: ShapeshiftOrderResponse = {
      deposit: '0x0',
      depositAmount: '0',
      expiration: 100,
      maxLimit: 1,
      minerFee: '0.1',
      orderId: '1',
      pair: 'BTC_ETH',
      quotedRate: '1',
      withdrawal: '0x0',
      withdrawalAmount: '2'
    };
    const successOrder = { success: orderResp };
    const errorOrder = { error: 'message' };
    const connectionErrMsg =
      'Connection Error. Please check the developer console for more details and/or contact support';

    const data = {} as any;
    data.gen = cloneableGenerator(postShapeshiftOrderCreate)(action);

    let random: () => number;
    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should put stopLoadShapeshiftRatesSwap', () => {
      expect(data.gen.next().value).toEqual(put(stopLoadShapeshiftRatesSwap()));
    });

    it('should call shapeshift.sendAmount', () => {
      data.clone1 = data.gen.clone();
      expect(data.gen.next().value).toEqual(
        apply(shapeshift, shapeshift.sendAmount, [
          action.payload.withdrawal,
          action.payload.originKind,
          action.payload.destinationKind,
          action.payload.destinationAmount
        ])
      );
    });

    it('should put shapeshiftOrderCreateSucceededSwap', () => {
      data.clone2 = data.gen.clone();
      expect(data.gen.next(successOrder).value).toEqual(
        put(shapeshiftOrderCreateSucceededSwap(successOrder.success))
      );
    });

    it('should put changeStepSwap', () => {
      expect(data.gen.next().value).toEqual(put(changeStepSwap(3)));
    });

    it('should put startOrderTimerSwap', () => {
      expect(data.gen.next().value).toEqual(put(startOrderTimerSwap()));
    });

    it('should put startPollShapeshiftOrderStatus', () => {
      expect(data.gen.next().value).toEqual(put(startPollShapeshiftOrderStatus()));
    });

    // failure modes
    it('should handle a connection exeception', () => {
      expect(data.clone1.throw().value).toEqual(
        put(showNotification('danger', connectionErrMsg, TEN_SECONDS))
      );
      expect(data.clone1.next().value).toEqual(put(shapeshiftOrderCreateFailedSwap()));
      expect(data.clone1.next().done).toEqual(true);
    });

    it('should handle an errored order', () => {
      expect(data.clone2.next(errorOrder).value).toEqual(
        put(showNotification('danger', `Shapeshift Error: ${errorOrder.error}`, TEN_SECONDS))
      );
      expect(data.clone2.next().value).toEqual(put(shapeshiftOrderCreateFailedSwap()));
    });
  });

  describe('bityOrderTimeRemaining*', () => {
    const orderTime = new Date().toISOString();
    const orderTimeExpired = new Date().getTime() - ELEVEN_SECONDS;
    const swapValidFor = 10; //seconds
    const swapOrder = {
      ...INITIAL_SWAP_STATE,
      orderTimestampCreatedISOString: orderTime,
      validFor: swapValidFor
    };
    const swapOrderExpired = {
      ...INITIAL_SWAP_STATE,
      orderTimestampCreatedISOString: new Date(orderTimeExpired).toISOString(),
      validFor: swapValidFor
    };
    let random: () => number;

    const data = {} as any;
    data.gen = cloneableGenerator(bityOrderTimeRemaining)();

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should call delay of one second', () => {
      expect(data.gen.next(true).value).toEqual(call(delay, ONE_SECOND));
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should handle if isValidUntil.isAfter(now)', () => {
      data.clone2 = data.gen.clone();
      const result = data.clone2.next(swapOrder).value;
      expect(result).toHaveProperty('PUT');
      expect(result.PUT.action.type).toEqual('SWAP_ORDER_TIME');
      expect(result.PUT.action.payload).toBeGreaterThan(0);
    });

    it('should handle an OPEN order state', () => {
      const openOrder = { ...swapOrderExpired, bityOrderStatus: 'OPEN' };
      data.OPEN = data.gen.clone();
      expect(data.OPEN.next(openOrder).value).toEqual(put(orderTimeSwap(0)));
      expect(data.OPEN.next().value).toEqual(put(stopPollBityOrderStatus()));
      expect(data.OPEN.next().value).toEqual(put({ type: TypeKeys.SWAP_STOP_LOAD_BITY_RATES }));
      expect(data.OPEN.next().value).toEqual(
        put(showNotification('danger', ORDER_TIMEOUT_MESSAGE, Infinity))
      );
    });

    it('should handle a CANC order state', () => {
      const cancOrder = { ...swapOrderExpired, bityOrderStatus: 'CANC' };
      data.CANC = data.gen.clone();
      expect(data.CANC.next(cancOrder).value).toEqual(put(stopPollBityOrderStatus()));
      expect(data.CANC.next().value).toEqual(put({ type: TypeKeys.SWAP_STOP_LOAD_BITY_RATES }));
      expect(data.CANC.next().value).toEqual(
        put(showNotification('danger', ORDER_TIMEOUT_MESSAGE, Infinity))
      );
    });

    it('should handle a RCVE order state', () => {
      const rcveOrder = { ...swapOrderExpired, bityOrderStatus: 'RCVE' };
      data.RCVE = data.gen.clone();
      expect(data.RCVE.next(rcveOrder).value).toEqual(
        put(showNotification('warning', ORDER_TIMEOUT_MESSAGE, Infinity))
      );
    });

    it('should handle a FILL order state', () => {
      const fillOrder = { ...swapOrderExpired, bityOrderStatus: 'FILL' };
      data.FILL = data.gen.clone();
      expect(data.FILL.next(fillOrder).value).toEqual(put(stopPollBityOrderStatus()));
      expect(data.FILL.next().value).toEqual(put({ type: TypeKeys.SWAP_STOP_LOAD_BITY_RATES }));
    });
  });

  describe('shapeshiftOrderTimeRemaining*', () => {
    const orderTime = new Date().toISOString();
    const orderTimeExpired = new Date().getTime() - ELEVEN_SECONDS;
    const swapValidFor = 10; //seconds
    const swapOrder = {
      ...INITIAL_SWAP_STATE,
      orderTimestampCreatedISOString: orderTime,
      validFor: swapValidFor
    };
    const swapOrderExpired = {
      ...INITIAL_SWAP_STATE,
      orderTimestampCreatedISOString: new Date(orderTimeExpired).toISOString(),
      validFor: swapValidFor
    };
    let random: () => number;

    const data = {} as any;
    data.gen = cloneableGenerator(shapeshiftOrderTimeRemaining)();

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should call delay of one second', () => {
      expect(data.gen.next(true).value).toEqual(call(delay, ONE_SECOND));
    });

    it('should select getSwap', () => {
      expect(data.gen.next().value).toEqual(select(getSwap));
    });

    it('should handle if isValidUntil.isAfter(now)', () => {
      data.clone2 = data.gen.clone();
      const result = data.clone2.next(swapOrder).value;
      expect(result).toHaveProperty('PUT');
      expect(result.PUT.action.type).toEqual('SWAP_ORDER_TIME');
      expect(result.PUT.action.payload).toBeGreaterThan(0);
    });

    it('should handle an no_deposits order state', () => {
      const openOrder = { ...swapOrderExpired, shapeshiftOrderStatus: 'no_deposits' };
      data.OPEN = data.gen.clone();
      expect(data.OPEN.next(openOrder).value).toEqual(put(orderTimeSwap(0)));
      expect(data.OPEN.next().value).toEqual(put(stopPollShapeshiftOrderStatus()));
      expect(data.OPEN.next().value).toEqual(
        put({ type: TypeKeys.SWAP_STOP_LOAD_SHAPESHIFT_RATES })
      );
      expect(data.OPEN.next().value).toEqual(
        put(showNotification('danger', ORDER_TIMEOUT_MESSAGE, Infinity))
      );
    });

    it('should handle a failed order state', () => {
      const cancOrder = { ...swapOrderExpired, shapeshiftOrderStatus: 'failed' };
      data.CANC = data.gen.clone();
      expect(data.CANC.next(cancOrder).value).toEqual(put(stopPollShapeshiftOrderStatus()));
      expect(data.CANC.next().value).toEqual(
        put({ type: TypeKeys.SWAP_STOP_LOAD_SHAPESHIFT_RATES })
      );
      expect(data.CANC.next().value).toEqual(
        put(showNotification('danger', ORDER_TIMEOUT_MESSAGE, Infinity))
      );
    });

    it('should handle a received order state', () => {
      const rcveOrder = { ...swapOrderExpired, shapeshiftOrderStatus: 'received' };
      data.RCVE = data.gen.clone();
      expect(data.RCVE.next(rcveOrder).value).toEqual(
        put(showNotification('warning', ORDER_RECEIVED_MESSAGE, Infinity))
      );
    });

    it('should handle a complete order state', () => {
      const fillOrder = { ...swapOrderExpired, shapeshiftOrderStatus: 'complete' };
      data.COMPLETE = data.gen.clone();
      expect(data.COMPLETE.next(fillOrder).value).toEqual(put(stopPollShapeshiftOrderStatus()));
      expect(data.COMPLETE.next().value).toEqual(
        put({ type: TypeKeys.SWAP_STOP_LOAD_SHAPESHIFT_RATES })
      );
      expect(data.COMPLETE.next().value).toEqual(put(stopOrderTimerSwap()));
    });
  });
});
//#endregion Orders

//#region Rates
describe('swap: Sagas (Rates)', () => {
  describe('loadBityRates*', () => {
    const gen1 = loadBityRates();
    const apiResponse = {
      BTCETH: {
        id: 'BTCETH',
        options: [{ id: 'BTC' }, { id: 'ETH' }],
        rate: 23.27855114
      },
      ETHBTC: {
        id: 'ETHBTC',
        options: [{ id: 'ETH' }, { id: 'BTC' }],
        rate: 0.042958
      }
    };
    const err = { message: 'error' };
    let random: () => number;

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should call getAllRates', () => {
      expect(gen1.next().value).toEqual(call(getAllRates));
    });

    it('should put loadBityRatesSucceededSwap', () => {
      expect(gen1.next(apiResponse).value).toEqual(put(loadBityRatesSucceededSwap(apiResponse)));
    });

    it(`should delay for ${POLLING_CYCLE}ms`, () => {
      expect(gen1.next().value).toEqual(call(delay, POLLING_CYCLE));
    });

    it('should handle an exception', () => {
      const errGen = loadBityRates();
      errGen.next();
      expect((errGen as any).throw(err).value).toEqual(select(getHasNotifiedRatesFailure));
      expect(errGen.next(false).value).toEqual(put(showNotification('danger', err.message)));
      expect(errGen.next().value).toEqual(put(loadBityRatesFailedSwap()));
      expect(errGen.next().value).toEqual(call(delay, POLLING_CYCLE));
    });

    it('should not notify on subsequent exceptions', () => {
      const noNotifyErrGen = loadBityRates();
      noNotifyErrGen.next();
      expect((noNotifyErrGen as any).throw(err).value).toEqual(select(getHasNotifiedRatesFailure));
      expect(noNotifyErrGen.next(true).value).toEqual(put(loadBityRatesFailedSwap()));
      expect(noNotifyErrGen.next().value).toEqual(call(delay, POLLING_CYCLE));
    });
  });

  describe('loadShapeshiftRates*', () => {
    const gen1 = loadShapeshiftRates();

    const apiResponse = {
      ['1SSTANT']: {
        id: '1STANT',
        options: [
          {
            id: '1ST',
            status: 'available',
            image: 'https://shapeshift.io/images/coins/firstblood.png',
            name: 'FirstBlood'
          },
          {
            id: 'ANT',
            status: 'available',
            image: 'https://shapeshift.io/images/coins/aragon.png',
            name: 'Aragon'
          }
        ],
        rate: '0.24707537',
        limit: 5908.29166225,
        min: 7.86382979
      }
    };
    const err = 'error';
    let random: () => number;

    beforeAll(() => {
      random = Math.random;
      Math.random = () => 0.001;
    });

    afterAll(() => {
      Math.random = random;
    });

    it('should race shapeshift.getAllRates', () => {
      expect(gen1.next().value).toEqual(
        race({
          tokens: call(shapeshift.getAllRates),
          timeout: call(delay, SHAPESHIFT_TIMEOUT)
        })
      );
    });

    it('should put loadShapeshiftRatesSucceededSwap', () => {
      expect(gen1.next({ tokens: apiResponse }).value).toEqual(
        put(loadShapeshiftRatesSucceededSwap(apiResponse as any))
      );
    });

    it(`should delay for ${POLLING_CYCLE}ms`, () => {
      expect(gen1.next().value).toEqual(call(delay, POLLING_CYCLE));
    });

    it('should handle an exception', () => {
      const errGen = loadShapeshiftRates();
      errGen.next();
      expect((errGen as any).throw(err).value).toEqual(select(getHasNotifiedRatesFailure));
      expect(errGen.next(false).value).toEqual(
        put(
          showNotification(
            'danger',
            'Failed to load swap rates from ShapeShift, please try again later'
          )
        )
      );
      expect(errGen.next().value).toEqual(put(loadShapeshiftRatesFailedSwap()));
    });

    it('should not notify on subsequent exceptions', () => {
      const noNotifyErrGen = loadShapeshiftRates();
      noNotifyErrGen.next();
      expect((noNotifyErrGen as any).throw(err).value).toEqual(select(getHasNotifiedRatesFailure));
      expect(noNotifyErrGen.next(true).value).toEqual(put(loadShapeshiftRatesFailedSwap()));
    });
  });

  describe('handleBityRates*', () => {
    const gen = handleBityRates();
    const mockTask = createMockTask();

    it('should fork loadBityRates', () => {
      expect(gen.next().value).toEqual(fork(loadBityRates));
    });

    it('should take SWAP_STOP_LOAD_BITY_RATES', () => {
      expect(gen.next(mockTask).value).toEqual(take(TypeKeys.SWAP_STOP_LOAD_BITY_RATES));
    });

    it('should cancel loadBityRatesTask', () => {
      expect(gen.next().value).toEqual(cancel(mockTask));
    });

    it('should be done', () => {
      expect(gen.next().done).toEqual(true);
    });
  });

  describe('handleShapeshiftRates*', () => {
    const gen = handleShapeshiftRates();
    const mockTask = createMockTask();

    it('should fork loadShapeshiftRates', () => {
      expect(gen.next().value).toEqual(fork(loadShapeshiftRates));
    });

    it('should take SWAP_STOP_LOAD_BITY_RATES', () => {
      expect(gen.next(mockTask).value).toEqual(take(TypeKeys.SWAP_STOP_LOAD_SHAPESHIFT_RATES));
    });

    it('should cancel loadShapeShiftRatesTask', () => {
      expect(gen.next().value).toEqual(cancel(mockTask));
    });

    it('should be done', () => {
      expect(gen.next().done).toEqual(true);
    });
  });
});
//#endregion Rates
