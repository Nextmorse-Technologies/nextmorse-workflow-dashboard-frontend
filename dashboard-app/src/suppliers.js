/* The suppliers on record (contacts categorised Supplier, Nov 2026).
   Suppliers are not clients — no client row exists for any of them —
   so a vendor bill names its supplier as free text, from this list
   or typed in. Shared by the Billing form and the Vendor services
   tab; it lives here so neither component imports the other. */
export const SUPPLIERS = [
  'Babal.Host',
  'Real Property Management Services Pvt. Ltd.',
  'Bijay Khadya and Gas Store',
  'Bagmati Office Suppliers',
  'Print Bazar',
  'Dish Home',
];
export const SUPPLIER_OTHER = '__other';
