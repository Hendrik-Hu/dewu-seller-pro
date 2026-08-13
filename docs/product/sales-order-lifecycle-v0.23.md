# v0.23 Sales Order Lifecycle Contract

## Why this is a separate domain

`products.status = shipping` already means purchasing inventory in transit. It must never be reused for a sold order waiting to ship. A sale also lasts longer than a single outbound activity: it has fulfillment, authentication, return, and settlement states that need their own identity and audit trail.

## Inventory and ledger semantics

1. Creating a sale order atomically reserves sellable inventory by reducing the available product stock. It does not create an outbound activity yet.
2. Confirming shipment creates exactly one outbound activity from the order's frozen product, cost, price, quantity, platform, and fee snapshot. It does not reduce stock again.
3. Canceling an unshipped order restores the reserved inventory exactly once and records an order event plus a restore activity.
4. Authentication failure does not immediately restore inventory. The order enters a return path and inventory is restored only when the seller confirms physical receipt.
5. A settled order that is refunded must also pass through return receipt before refund completion. Refund accounting will be an explicit event rather than deletion or mutation of the original outbound record.
6. Existing legacy outbound activities remain readable and settleable. They are not silently converted into orders.

## State chain

```text
pending_shipment
  -> shipped
  -> authenticating
  -> authenticated
  -> settled

pending_shipment -> canceled (restore once)
authenticating -> auth_failed -> returning -> returned (restore once)
settled -> returning -> returned -> refunded
```

`shipped -> authenticated` is allowed for a seller who records the platform result in one step. Every write still goes through a server transition RPC.

## Server invariants

- `sales_orders` and `sales_order_events` are readable only by `auth.uid()` and have no direct client insert, update, or delete grants.
- Creation and every transition bind a stable `operationId` to a payload fingerprint. Replays return the stored result; payload changes fail.
- Order creation shares the existing inventory variant advisory-lock domain before locking the product row.
- A transition locks the order row, verifies the expected status/version, and then performs its inventory or activity effect in the same transaction.
- `outbound_activity_id` is unique and immutable once shipment succeeds.
- `inventory_restored` can move from false to true only through cancel or confirmed return and cannot be reset.
- Fee and unit-cost snapshots are frozen when the order is created. Scheme edits never rewrite an existing order.
- Settlement continues to use the frozen outbound activity cost and appends settlement audit revisions.

## Client flow

- The existing Outbound task becomes sale-order creation and ends at a confirmation screen that clearly says inventory will be reserved and the order will enter Pending Shipment.
- Home shows four order queues: Pending Shipment, Authentication, Settlement, and Exceptions.
- An order detail screen displays one primary next action, a compact event timeline, and explicit inventory impact before confirmation.
- Legacy direct outbound remains available only as an intentional quick bookkeeping path during migration, not as the default order workflow.
