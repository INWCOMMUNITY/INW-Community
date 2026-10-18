-- 20260904160000 dropped CONSTRAINT "Shipment_order_id_key", but the original
-- unique was created as an index. Postgres left that index in place, so a
-- return label could not be saved next to the outbound shipment.
DROP INDEX IF EXISTS "Shipment_order_id_key";
