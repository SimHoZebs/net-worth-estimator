# Pending settlement and occurrence claims

A pending bank row is an authorization, not a posted charge. Sync stores it
disabled, so it never moves balances. A live hold shows **Pending**; a hold
that vanished without posting shows **Did not post**.

## Settlement updates the hold in place

A posted charge that settles a vanished hold updates that hold under its own
id instead of deleting the hold and creating the charge. The posted values
and the posted bank key land on the hold's row.

The join is tip-bounded: same mirror account, same direction, the same
leading merchant tokens after authorization noise and processor prefixes are
removed, posted within a week of the authorization, amount within the tip
band. A hold descriptor that names the authorization (`LYFT *TEMP AUTH
HOLD`) still joins the posted descriptor for the same merchant
(`LYFT *STANDARD`). When both descriptors carry a branch or product token,
the tokens must agree. A single-token hold still lists each variant, and the
uniqueness guard or the owner picks the right one. The pair must be unique.
Several candidates for one hold, or several holds for one candidate, void the
hold and insert the charge, and the owner links or removes either side by
hand. Zero-amount authorizations never join.
Direction mismatches never join. Uncovered accounts never convert. A posted
charge that reuses its hold's id updates by key.

The transaction detail uses the same merchant key to list candidates for an
already-void hold. The closest candidate is preselected, and the picker keeps
`No link — just remove` available. Removing the hold record leaves the posted
charge unchanged.

## Occurrence claims survive settlement

A one-time row records an occurrence of a scheduled rule through **Records
an occurrence of** and **Replaces occurrence on**. Pending rows accept
claims while their other values stay locked: the claim lives outside the
synced columns, and the pending-to-posted convert keeps the same row id.

Claiming clears pending, enables the row so it participates, and promotes
the posted time from the bank's transaction instant. Pending seeds carry no
posted time, and recorded rows require a positive one. The editor rejects a
claim with no occurrence date instead of saving the row unlinked.

A settled charge that matches a claimed hold joins it the same way, so the
claim survives settlement. Refreshes never demote a claimed row back to a
pending seed.

Validation requires each claimed occurrence to be a scheduled date of an
existing rule, with one claim per rule and date.
