-- Allow canceled Wix sale facts to leave APPLIED after a successful restock.
ALTER TYPE "wix_order_line_sale_apply_state" ADD VALUE IF NOT EXISTS 'RESTOCKED';
