import { z } from "zod";

/**
 * Response schemas for the Trading 212 public API.
 *
 * Two rules shape every schema here.
 *
 * **Unknown fields are kept, not rejected.** The API is in beta and gains
 * fields without notice. A strict schema would turn a harmless upstream
 * addition into a total outage, so objects are permissive about what they do
 * not know.
 *
 * **Known fields are typed strictly.** Anything that could be quoted back to
 * a user as money is a number or it is a parse failure. Passing a string
 * through where a balance is expected is how a wrong figure ends up in an
 * answer, and an error is always better than a plausible wrong number.
 *
 * Optionality is generous: Trading 212 omits fields that do not apply (an
 * unfilled order has no fill price) and returns `null` for others. Both are
 * accepted and normalised to `undefined` at the tool layer.
 */

const money = z.number();
const nullableMoney = money.nullish();
const nullableString = z.string().nullish();
const timestamp = z.string();

export const accountCashSchema = z.looseObject({
  free: nullableMoney,
  total: nullableMoney,
  ppl: nullableMoney,
  result: nullableMoney,
  invested: nullableMoney,
  pieCash: nullableMoney,
  blocked: nullableMoney,
});
export type AccountCash = z.infer<typeof accountCashSchema>;

export const accountInfoSchema = z.looseObject({
  id: z.number().nullish(),
  currencyCode: nullableString,
});
export type AccountInfo = z.infer<typeof accountInfoSchema>;

export const positionSchema = z.looseObject({
  ticker: z.string(),
  quantity: money,
  averagePrice: nullableMoney,
  currentPrice: nullableMoney,
  /** Unrealised profit or loss in the account currency. */
  ppl: nullableMoney,
  /** The portion of `ppl` attributable to currency movement. */
  fxPpl: nullableMoney,
  initialFillDate: nullableString,
  frontend: nullableString,
  maxBuy: nullableMoney,
  maxSell: nullableMoney,
  pieQuantity: nullableMoney,
});
export type Position = z.infer<typeof positionSchema>;

export const positionsSchema = z.array(positionSchema);

export const instrumentSchema = z.looseObject({
  ticker: z.string(),
  type: nullableString,
  isin: nullableString,
  currencyCode: nullableString,
  name: nullableString,
  shortName: nullableString,
  workingScheduleId: z.number().nullish(),
  minTradeQuantity: nullableMoney,
  maxOpenQuantity: nullableMoney,
  addedOn: nullableString,
});
export type Instrument = z.infer<typeof instrumentSchema>;

export const instrumentsSchema = z.array(instrumentSchema);

export const timeEventSchema = z.looseObject({
  date: timestamp,
  type: nullableString,
});

export const workingScheduleSchema = z.looseObject({
  id: z.number(),
  timeEvents: z.array(timeEventSchema).nullish(),
});

export const exchangeSchema = z.looseObject({
  id: z.number(),
  name: nullableString,
  workingSchedules: z.array(workingScheduleSchema).nullish(),
});
export type Exchange = z.infer<typeof exchangeSchema>;

export const exchangesSchema = z.array(exchangeSchema);

export const orderSchema = z.looseObject({
  id: z.number(),
  ticker: nullableString,
  quantity: nullableMoney,
  filledQuantity: nullableMoney,
  limitPrice: nullableMoney,
  stopPrice: nullableMoney,
  value: nullableMoney,
  filledValue: nullableMoney,
  type: nullableString,
  strategy: nullableString,
  status: nullableString,
  creationTime: nullableString,
});
export type Order = z.infer<typeof orderSchema>;

export const ordersSchema = z.array(orderSchema);

export const taxSchema = z.looseObject({
  name: nullableString,
  quantity: nullableMoney,
  fillId: nullableString,
  timeCharged: nullableString,
});

export const historicalOrderSchema = z.looseObject({
  id: z.number(),
  ticker: nullableString,
  type: nullableString,
  status: nullableString,
  orderedQuantity: nullableMoney,
  filledQuantity: nullableMoney,
  orderedValue: nullableMoney,
  filledValue: nullableMoney,
  limitPrice: nullableMoney,
  stopPrice: nullableMoney,
  fillPrice: nullableMoney,
  fillCost: nullableMoney,
  fillResult: nullableMoney,
  fillType: nullableString,
  fillId: z.number().nullish(),
  parentOrder: z.number().nullish(),
  executor: nullableString,
  timeValidity: nullableString,
  taxes: z.array(taxSchema).nullish(),
  dateCreated: nullableString,
  dateExecuted: nullableString,
  dateModified: nullableString,
});
export type HistoricalOrder = z.infer<typeof historicalOrderSchema>;

export const dividendSchema = z.looseObject({
  reference: nullableString,
  ticker: nullableString,
  quantity: nullableMoney,
  amount: nullableMoney,
  amountInEuro: nullableMoney,
  grossAmountPerShare: nullableMoney,
  paidOn: nullableString,
  type: nullableString,
});
export type Dividend = z.infer<typeof dividendSchema>;

export const transactionSchema = z.looseObject({
  reference: nullableString,
  type: nullableString,
  amount: nullableMoney,
  dateTime: nullableString,
});
export type Transaction = z.infer<typeof transactionSchema>;

export const pieResultSchema = z.looseObject({
  priceAvgInvestedValue: nullableMoney,
  priceAvgValue: nullableMoney,
  priceAvgResult: nullableMoney,
  priceAvgResultCoef: nullableMoney,
});

export const pieSchema = z.looseObject({
  id: z.number(),
  cash: nullableMoney,
  progress: nullableMoney,
  status: nullableString,
  dividendDetails: z
    .looseObject({
      gained: nullableMoney,
      reinvested: nullableMoney,
      inCash: nullableMoney,
    })
    .nullish(),
  result: pieResultSchema.nullish(),
});
export type Pie = z.infer<typeof pieSchema>;

export const piesSchema = z.array(pieSchema);

export const pieInstrumentSchema = z.looseObject({
  ticker: z.string(),
  currentShare: nullableMoney,
  expectedShare: nullableMoney,
  ownedQuantity: nullableMoney,
  issues: z.array(z.unknown()).nullish(),
  result: pieResultSchema.nullish(),
});

export const pieDetailSchema = z.looseObject({
  instruments: z.array(pieInstrumentSchema).nullish(),
  settings: z.looseObject({ id: z.number().nullish() }).loose().nullish(),
});
export type PieDetail = z.infer<typeof pieDetailSchema>;

export const exportSchema = z.looseObject({
  reportId: z.number(),
  status: nullableString,
  downloadLink: nullableString,
  timeFrom: nullableString,
  timeTo: nullableString,
  dataIncluded: z.looseObject({}).nullish(),
});
export type Export = z.infer<typeof exportSchema>;

export const exportsSchema = z.array(exportSchema);

/**
 * Cursor-paginated list envelope.
 *
 * `nextPagePath` is a server-supplied path rather than an opaque token, so it
 * is passed back verbatim rather than reconstructed.
 */
export function paginated<T extends z.ZodType>(item: T) {
  return z.looseObject({
    items: z.array(item),
    nextPagePath: z.string().nullish(),
  });
}

export const paginatedOrdersSchema = paginated(historicalOrderSchema);
export const paginatedDividendsSchema = paginated(dividendSchema);
export const paginatedTransactionsSchema = paginated(transactionSchema);
