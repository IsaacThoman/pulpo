# Financial oracle grid

3,975 cases cover all 55 registered financial functions, including the 54 explicitly requested in the sweep and ISPMT.

Generated locally with LibreOffice 26.8.2.2 (build 9dea406ab7695df6325b11b0e19fdca8db4b7276) and openpyxl. These are original synthetic formulas and numeric/error caches, with no third-party workbook content. Each JSON part is under 200 KB.

From the repository root:

```
~/.cache/pulpo-sheets-venv/bin/python -I packages/client-core/scripts/sheets/financial_oracle.py
PULPO_OFFICE_FIDELITY=1 npm run test -w @pulpo/client-core -- financial-fidelity
```

`financial_oracle.py --check` regenerates in a temporary directory and verifies the committed results without writing them. It uses the existing private-profile `lo_convert.sh` headless xlsx fidelity bridge; no Docker, server or shared LibreOffice profile. The Pulpo engine never produces expectations. The default suite separately tests Microsoft examples in `formula/functions/financial.test.ts`.

Rows are `[formula, expected]`, or `[formula, ExcelExpected, reason, LibreOfficeCache]` when Calc differs. All original formulas are sent to Calc, including unsupported argument signatures. The expectation test only runs under `PULPO_OFFICE_FIDELITY=1`; the second opt-in test actually recalculates the workbook. Numeric comparison uses 1e-7 relative/absolute tolerance, allowing documented iterative solver precision.

## Coverage and argument review

Every documented position is read by the implementation and independently replaced with nonnumeric text, a propagated error, zero, a negative value and a fraction. Seeds for argument mutation are valid so earlier errors cannot hide later arguments. Optional suffixes are omitted, supplied, and explicitly left empty. Integer argument truncation and nontruncated payment type checks are distinct.

| Functions | Grid and validation |
| --- | --- |
| ACCRINT, ACCRINTM | Dates, positive rate/par, optional par/basis/method, before/on/after first interest, long accruals; all bases and frequencies. |
| COUPDAYBS, COUPDAYS, COUPDAYSNC, COUPNCD, COUPNUM, COUPPCD | Settlement/maturity order, frequency 1/2/4 versus 0/3, bases 0–4 versus -1/5, coupon date ±1, February 28/29, August 30/31, leap-year maturities, serial zero. |
| PRICE, YIELD, DURATION, MDURATION | Same date/basis/frequency grid, positive/nonnegative price/redemption/coupon/yield conditions, final single-coupon interval and solver bounds. |
| DISC, INTRATE, RECEIVED, PRICEDISC, PRICEMAT, YIELDDISC, YIELDMAT | All bases, date/issue order, fractional dates, positive investment/redemption/discount, permitted zero coupon, denominator domains. |
| ODDFPRICE, ODDFYIELD, ODDLPRICE, ODDLYIELD | Short/long first and last periods, end-of-month anchors, leap years, all bases/frequencies, all dates and rates, first-coupon/maturity alignment. |
| TBILLPRICE, TBILLEQ, TBILLYIELD | 1/181/182/183/364/365/366/367-day maturities, date ordering/year limits, positive price/discount. |
| AMORDEGRC, AMORLINC | Bases 0–4 (2 rejected by Office), purchase/first-period order, positive cost/rate, salvage limits, periods 0/1/4/6/10, coefficients and disallowed asset lives. |
| DB, DDB, VDB, SLN, SYD | Life 1/2.5/10, partial/whole/out-of-range periods, month 1/7/12, factor 1/1.5/2/5, switch on/off, nonnegative cost/salvage, zero-life division, optional factor/month distinctions. |
| PMT, PPMT, IPMT, ISPMT, CUMIPMT, CUMPRINC, NPER, RATE, FV, PV | Zero/positive/negative rates, 1/12/120 periods, both payment types, per boundaries, multiple guesses, all optional positions, payment type fractions, cumulative interval restrictions. |
| NPV, XNPV, IRR, XIRR, MIRR | Positive/negative/mixed flows, multiple roots, ignored text, invalid array items, date/count/order/range failures, equal dates, zero/negative rates and guesses. |
| EFFECT, NOMINAL, DOLLARDE, DOLLARFR, FVSCHEDULE, PDURATION, RRI | Negative/zero/fractional periods and fractions, conversion denominator, nonpositive growth inputs, text in schedules, optional argument/error coercion. |

## Microsoft sources and Calc deviations

The independent Python reference contains explicit validation/formula exceptions, not captured Pulpo outputs. The sources are [Microsoft's financial function index](https://support.microsoft.com/en-us/excel/financial-functions-reference), the individual `https://support.microsoft.com/en-us/excel/functions/<lowercase-name>-function` pages, and [MS-OI29500](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/) Part 1 section 18.17.7 (use the function-named entries in its table of contents). Relevant rules were read for every function represented in that specification, together with the Support argument descriptions/remarks. These reason codes appear directly in each affected test row:

- `excel-validation`, `excel-domain`: Calc exports many numeric-domain failures as `#VALUE!` (Err:502) or iterative failures as `#N/A`; Office requires `#NUM!`. Includes SYD invalid periods, AMORDEGRC forbidden asset lives, AMOR basis 2, date ranges and scalar/array error propagation. XNPV's rate must be positive per MS-OI29500 §18.17.7.351 (stricter than Calc); XIRR permits dates preceding the first date per §18.17.7.350, despite the older Support remarks. Invalid XIRR dates are `#VALUE!`.
- `excel-accrint-quasi-coupons`: Calc rejects the eighth ACCRINT argument and its seven-argument implementation ignores the first-interest schedule. Office sums Ai/NLi on the quasi-coupon grid and honors FALSE's first-interest interval. [ACCRINT spec](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/e32cd66e-a035-4338-9e6e-a75929aaa73f). The spec explicitly sets omitted par to 0.001; the ISO standard and Support page say 1000. We follow the Office-specific spec for ACCRINT and ACCRINTM; explicit par is unchanged.
- `excel-day-basis`: Calc's add-in date basis differs around February/31st and uses a single year's length for some multi-year intervals. The Office-specific NASD/actual-year rules are in each security's MS-OI29500 entry. Maturity securities use the specified year fractions for DIM, DSM and A.
- `excel-duration-coupon-time`: Calc measures fractional cash-flow time using YEARFRAC to maturity. Microsoft's discounted coupon-weighted duration uses DSC/E plus the integer coupon offsets. Modified duration divides that result by 1 + yield/frequency.
- `excel-odd-coupon-formula`: Calc returns `#VALUE!` for valid ODDF* inputs here and uses different ODDL* quasi-period day counts. References implement Microsoft's discounted odd-first-coupon equation, its inverse, and the published ODDLYIELD simple-interest equation/inverse. Default-on tests pin all four documented examples.
- `excel-final-coupon`: Calc PRICE/YIELD differ in the final coupon period, most visibly next to month-end maturity. References use Microsoft's N=1 simple-interest price/yield equations, and discounted cash flows for N>1. Negative yields are allowed when solving a valid positive price; PRICE's input yield remains nonnegative.
- `excel-tbill-days`: Calc's T-bill add-ins use different day counts and accept some over-one-year TBILLPRICE inputs. Use Microsoft's actual elapsed-day PRICE/YIELD equations and the published TBILLEQ equation over the accepted one-year interval. Calendar leap-anniversary validation is explicit.
- `excel-ipmt-fractional-period`, `excel-ddb-fractional`: Office allows `1 <= per < nper+1` for IPMT (PPMT is limited to nper), and DDB's first fractional period is the difference between initial and fractional depreciated book values. Calc rejects these inputs.
- `excel-division-by-zero`, `excel-no-root`: Division-by-zero annuity/cash-flow cases and RATE equations without a finite root cannot use Calc's exported error or a spurious approximate root.
- `excel-npv-ignore-text`: Excel ignores text in a flow array; this Calc import returns an error. FVSCHEDULE must instead reject a nonnumeric schedule (covered by `excel-validation`).
- `excel-amor-first-period`, `excel-epoch-coupons`, `excel-zero-cost`, `excel-salvage-exceeds-cost`, `excel-db-formula`: Explicit first-period proration/rounding, Excel's epoch for internal pre-1900 coupon boundaries, zero-cost and salvage-exceeds-cost depreciation rules. Internal coupon boundaries may precede the epoch even though negative input dates are rejected.

The grid is deterministic coverage, not a claim that every possible financial input is tested. Office-specific documentation takes precedence where the oracle demonstrably differs. Solvers remain subject to the engine's shared calculation work allowance.
