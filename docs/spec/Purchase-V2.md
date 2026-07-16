# Purchase Module — Field Specification

> **Source:** `Hyp_ERP_Planning_Devop.xlsx`, sheet `Purchase V2`.
> Faithful transcription. Sections 1–4 are the client's spec — **implement exactly these fields, no additions, no omissions.**
> Section 5 is *not* part of the spec — it is our list of ambiguities. Do not invent answers to it.

**Navigation:** Main Tab `Purchase` → three sub tabs.

```
Purchase Module
│
├── 1. Supplier Creation
│      ├── Supplier Information
│      ├── Contact Details
│      ├── Banking
│      └── Payment Terms
│
├── 2. Record Purchase
│      ├── Purchase Header
│      ├── Shipment Details
│      ├── Item Details
│      ├── Pricing
│      ├── Costing
│      ├── Customer Allocation
│      └── Attachments
│
└── 3. Platform Hedging / LME Records
       ├── LME Pricing
       ├── Hedging Details
       ├── Profit Analysis      ← needs Sales. OUT OF 90-DAY SCOPE.
       └── Sales Allocation     ← needs Sales. OUT OF 90-DAY SCOPE.
```

---

## 1. Sub Tab 1 — Supplier Creation

| Field Name | Purpose | Field Type | Data Type | Mandatory | Remarks |
|---|---|---|---|---|---|
| Supplier Code | Unique supplier identification | Auto Generated | String | Yes | Read Only |
| Supplier Name | Supplier selection | Textbox | String | Yes | Unique |
| Supplier Type | Local/International | Dropdown | Enum | Yes | Configurable |
| Contact Person | Primary contact | Textbox | String | No | |
| Mobile Number | Contact number | Textbox | Phone | No | Validation |
| Email Address | Email | Textbox | Email | No | Validation |
| Country | Supplier country | Dropdown | Master | Yes | Country Master |
| City | Supplier city | Dropdown | Master | No | Based on Country |
| Address | Supplier address | Text Area | String | No | |
| Tax Registration No. | VAT/TRN | Textbox | String | No | |
| Payment Terms | Credit terms | Dropdown | Master | Yes | 30 Days, Advance, etc. |
| Default Currency | Purchase currency | Dropdown | Master | Yes | USD, AED, EUR |
| Bank Details | Payment information | Text Area | String | No | |
| Status | Supplier status | Toggle | Boolean | Yes | Active/Inactive |
| Remarks | Additional notes | Text Area | String | No | |

### Functional Requirements — Supplier Creation

| FR ID | Requirement |
|---|---|
| FR-001 | User can create a new supplier. |
| FR-002 | System shall generate a unique Supplier Code automatically. |
| FR-003 | User can edit supplier information. |
| FR-004 | User can activate/deactivate a supplier. |
| FR-005 | Duplicate supplier names shall not be allowed. |
| FR-006 | Supplier will be available in Purchase Transactions after creation. |

---

## 2. Sub Tab 2 — Record Purchase

### A. Purchase Header

| Field Name | Purpose | Field Type | Data Type | Mandatory | Remarks |
|---|---|---|---|---|---|
| Purchase Number | Unique purchase ID | Auto Generated | String | Yes | Read Only |
| Purchase Date | Transaction date | Date Picker | Date | Yes | |
| Status | Workflow status | Dropdown | Enum | Yes | Draft, Approved, Posted |
| Branch | Company branch | Dropdown | Master | Yes | |
| Buyer | Purchase officer | Dropdown | User | Yes | |

### B. Supplier Details

| Field Name | Purpose | Field Type | Data Type | Mandatory |
|---|---|---|---|---|
| Supplier | Supplier selection | Dropdown | Supplier Master | Yes |
| Supplier Invoice No. | Supplier invoice | Textbox | String | No |
| Supplier Reference No. | External reference | Textbox | String | No |

### C. Shipment Details

| Field Name | Purpose | Field Type | Data Type | Mandatory |
|---|---|---|---|---|
| Shipment Year | Shipment year | Auto/Dropdown | Number | Yes |
| Shipment Lot Number | Lot tracking | Textbox | String | Yes |
| Container Number | Container reference | Textbox | String | Yes |
| Bill of Lading No. | BL number | Textbox | String | Yes |
| Loading Date | Loading date | Date Picker | Date | Yes |
| Through | Transport mode | Dropdown | Enum | Yes |
| Vessel Name | Vessel details | Dropdown/Text | String | No |
| Voyage Number | Voyage reference | Textbox | String | No |
| Port of Loading | Origin port | Dropdown | Master | Yes |
| Port of Discharge | Destination port | Dropdown | Master | Yes |
| Warehouse | Receiving warehouse | Dropdown | Master | Yes |
| Incoterm | Delivery term | Dropdown | Master | Yes |

### D. Purchase Item

| Field Name | Purpose | Field Type | Data Type | Mandatory |
|---|---|---|---|---|
| Item | Purchased product | Dropdown | Item Master | Yes |
| Grade | Product grade | Dropdown | Master | No |
| Quantity | Purchased quantity | Decimal | Number | Yes |
| Unit of Measure | Measurement unit | Dropdown | Master | Yes |

### E. Purchase Pricing

| Field Name | Purpose | Field Type | Data Type | Mandatory | Calculation |
|---|---|---|---|---|---|
| Purchase Rate (USD) | Unit purchase price | Currency | Decimal | Yes | Manual/Auto |
| Purchase Amount (USD) | Total purchase | Currency | Decimal | Yes | **Qty × Rate** |
| Exchange Rate | USD to AED | Decimal | Decimal | Yes | Manual |
| Purchase Amount (AED) | Local value | Currency | Decimal | Yes | **USD × Exchange Rate** |

### F. Customer Allocation

| Field Name | Purpose | Field Type | Data Type | Mandatory |
|---|---|---|---|---|
| Reserved Customer | Customer allocation | Dropdown | Customer Master | No |
| Allocation % | Allocation ratio | Percentage | Decimal | No |

### G. Additional Cost

| Field Name | Purpose | Field Type | Data Type | Mandatory | Remarks |
|---|---|---|---|---|---|
| Freight | Freight cost | Currency | Decimal | No | |
| Insurance | Insurance cost | Currency | Decimal | No | |
| Customs | Customs duty | Currency | Decimal | No | |
| Other Charges | Miscellaneous | Currency | Decimal | No | **Field should be named by user** |
| Other Charges 2 | Miscellaneous | Currency | Decimal | No | **Field should be named by user** |
| Other Charges 3 | Miscellaneous | Currency | Decimal | No | **Field should be named by user** |

> The three "named by user" fields are **Tier 2 (Configurable)** — a real typed column with a user-overridable label. Renaming changes the label only: never the column, the query, or the calculation. This is the reference case for the field engine.

### H. Attachments

| Field Name | Purpose | Field Type | Data Type | Remarks |
|---|---|---|---|---|
| Invoice | Upload invoice | File Upload | PDF/Image | |
| Bill of Lading | Upload BL | File Upload | PDF | |
| Packing List | Upload PL | File Upload | PDF | |
| Certificate of Origin | Upload COO | File Upload | PDF | |
| Other Documents | Supporting files | Multi Upload | Any | **Field should be renamed by user** |
| Other Documents 2 | Supporting files | Multi Upload | Any | **Field should be renamed by user** |

### Functional Requirements — Record Purchase

| FR ID | Requirement | 90-day scope |
|---|---|---|
| FR-101 | System shall generate Purchase Number automatically. | ✅ |
| FR-102 | User shall select supplier from Supplier Master. | ✅ |
| FR-103 | User can record shipment information. | ✅ |
| FR-104 | User can add one or multiple purchase items. | ✅ |
| FR-105 | System shall calculate Purchase Amount automatically. | ✅ |
| FR-106 | System shall calculate AED amount using exchange rate. | ✅ |
| FR-107 | Purchase shall remain in Draft until approved. | ✅ |
| FR-108 | Approved purchase updates inventory. | ✅ |
| FR-109 | Purchase can be linked with Sales Module. | ❌ needs Sales |
| FR-110 | User can upload supporting documents. | ✅ |

---

## 3. Sub Tab 3 — Platform Hedging / LME Records

### A. LME Information

| Field Name | Purpose | Field Type | Data Type | Mandatory |
|---|---|---|---|---|
| Purchase Reference | Linked purchase | Lookup | Purchase ID | Yes |
| LME Exchange | Exchange | Dropdown | Master | Yes |
| LME Purchase Price (USD) | Market price | Currency | Decimal | Yes |
| LME Fixing Date | Fixing date | Date Picker | Date | Yes |
| Agreed Premium (%) | Premium | Percentage | Decimal | Yes |
| Final Purchase Rate (USD) | Purchase rate | **Calculated** | Currency | Yes |

### B. Hedging Details

| Field Name | Purpose | Field Type | Data Type |
|---|---|---|---|
| Hedge Platform | Trading platform | Dropdown | Master |
| Hedge Contract Number | Contract reference | Textbox | String |
| Hedge Position | Buy/Sell | Dropdown | Enum |
| Hedge Quantity | Hedged quantity | Decimal | Number |
| Hedge Rate | Hedging rate | Currency | Decimal |
| Hedge Date | Execution date | Date Picker | Date |
| Hedge Status | Position status | Dropdown | Enum |

### Functional Requirements — Hedging / LME

| FR ID | Requirement | 90-day scope |
|---|---|---|
| FR-201 | User shall record LME purchase price. | ✅ |
| FR-202 | User shall record LME Fixing Date. | ✅ |
| FR-203 | System shall calculate Final Purchase Rate. | ✅ |
| FR-204 | User can record Hedge Contract details. | ✅ |
| FR-205 | System shall calculate Profit/Loss automatically. | ❌ needs Sales |
| FR-206 | Purchase shall link with Sales transactions. | ❌ needs Sales |

---

## 4. Reference

### Field types (client's own definitions)

| Field Type | Use Case |
|---|---|
| Auto Generated | System-generated numbers (Purchase No., Supplier Code) |
| Textbox | Free-text values (BL No., Invoice No.) |
| Text Area | Long remarks or addresses |
| Dropdown | Select from predefined or master data |
| Lookup | Search and link records from another module |
| Date Picker | Dates such as Purchase Date or Loading Date |
| Decimal | Quantities, percentages, exchange rates |
| Currency | Monetary values with currency formatting |
| Percentage | Premiums, allocation percentages |
| Toggle | Yes/No or Active/Inactive |
| Calculated (Read Only) | Values computed automatically by the system |
| File Upload | Attach documents and images |
| Multi Upload | Attach multiple files to a transaction |

### Standard fields — every record

Purchase ID · Created By · Created Date · Modified By · Modified Date · Approved By · Approved Date · Version · Audit Log

### Calculations

```
Purchase Amount (USD)     = Quantity × Purchase Rate (USD)          FR-105
Purchase Amount (AED)     = Purchase Amount (USD) × Exchange Rate   FR-106
Final Purchase Rate (USD) = LME Price × (1 + Agreed Premium% / 100) FR-203
```

All three in `decimal.js` against `numeric` columns. **Never a JS float, not even an intermediate.**

### Masters required by this module

countries · cities · currencies · payment_terms · supplier_types · branches · items · item_grades · uom · ports · warehouses · incoterms · vessels · transport_modes · lme_exchanges · hedge_platforms · customers *(stub only — Reserved Customer needs the dropdown)*

---

## 5. Open questions — NOT part of the spec

**Do not invent answers to these.** If a task depends on one, stop and ask.

| # | Question | Blocks |
|---|---|---|
| 1 | Is Purchase Item **one per purchase or many**? FR-104 says many; section D reads as a single item block. Header/lines relationship is unclear. | Schema design — **ask before building D/E** |
| 2 | If many items: is Pricing (E) **per item or per purchase**? | Schema design |
| 3 | `Reserved Customer` is a single field but `Allocation %` implies splitting across several. **One customer, or many?** | Allocation table shape |
| 4 | How are Additional Costs (G) **allocated across items/lots** — by quantity, by value, or configurable? | Costing engine |
| 5 | Rounding mode for currency — banker's or half-up? Auditors will ask. | Money value object |
| 6 | Can `LME Fixing Date` be entered/amended **after** approval? Is there a provisional→final pricing flow? | Workflow immutability |
| 7 | `Shipment Year` is "Auto/Dropdown" — derived from Loading Date, or user-selected? | Field behaviour |
| 8 | Is `Hedge` one-per-purchase or many? Section B has no cardinality. | Schema design |
| 9 | Exchange Rate is "Manual" — should it default from the FX rate table for the purchase date? | FX engine |
| 10 | FR-108 "updates inventory" — does stock move at **Approved** or at **Posted**? Header says Draft/Approved/Posted; FR-107 only covers Draft→Approved. | Workflow + stock ledger |

Questions 1, 2, and 3 are structural. **Get them answered before writing the purchase schema** — they are cheap now and a migration later.
