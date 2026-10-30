// Demo data so a new workspace shows something useful. The buyer and ITT are fictional.

export const SAMPLE_PROFILE = {
  company: "Example Subsea Tools AS",
  summary: "Design, manufacture and rental of ROV tooling, hydraulic torque tools and subsea intervention equipment. Workshop in Bergen, 45 staff.",
  keywords: ["ROV tooling", "subsea", "hydraulic", "torque tool", "intervention", "rental", "workshop"],
  exclude_keywords: ["catering", "cleaning services", "IT consultancy"],
  cpv: ["4291", "4313", "7652", "5052", "3112"],
  countries: ["NOR", "GBR", "DNK", "NLD"],
  certifications: ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018", "Magnet JQS", "NORSOK Z-018", "NORSOK M-501", "IMCA R 004"],
  min_value_eur: 100000,
};

export const SAMPLE_LIBRARY = [
  { title: "ISO 9001:2015 certificate (DNV)", category: "quality", tags: ["ISO 9001", "quality management", "certificate"], body: "Certified to ISO 9001:2015 by DNV, certificate no. [placeholder], valid to [placeholder]. Scope: design, manufacture, rental and service of subsea tooling.", expires_at: "2027-06-30" },
  { title: "ISO 45001 and HSE statistics", category: "hse", tags: ["ISO 45001", "HSE", "LTI", "TRIF", "NORSOK S-006"], body: "Certified to ISO 45001:2018. HSE management system meets NORSOK S-006. LTI and TRIF figures for the last three years: [placeholder]. Safety delegate and AMU in place.", expires_at: "2027-06-30" },
  { title: "Supplier documentation to NORSOK Z-018", category: "documentation", tags: ["NORSOK Z-018", "SDRL", "MDR", "documentation", "data book"], body: "We deliver supplier documentation to NORSOK Z-018 using the operator's SDRL codes. Data books are compiled per tag and issued in PDF with native files on request.", expires_at: null },
  { title: "Coating to NORSOK M-501", category: "technical", tags: ["NORSOK M-501", "coating", "surface treatment", "system 7"], body: "Surface treatment and coating to NORSOK M-501 by our qualified coating subcontractor [placeholder], with FROSIO-certified inspectors.", expires_at: null },
  { title: "Transparency Act (Åpenhetsloven) statement", category: "legal", tags: ["Transparency Act", "åpenhetsloven", "human rights", "due diligence"], body: "We carry out due diligence under the Transparency Act and publish an annual statement at [placeholder URL]. Supplier code of conduct applies to all subcontractors.", expires_at: null },
  { title: "Standard payment terms and quote validity", category: "commercial", tags: ["payment", "validity", "invoice", "EHF"], body: "Prices are valid for 90 days. Payment 30 days net. Invoices sent as EHF/Peppol. Prices in NOK excluding VAT, delivered FCA Bergen (Incoterms 2020) unless stated.", expires_at: null },
  { title: "ROV torque tool range (class 1–7)", category: "technical", tags: ["ROV tooling", "torque tool", "ISO 13628-8", "API 17H", "class 1-7"], body: "Hydraulic torque tools for ISO 13628-8 / API 17H class 1–7 interfaces, with calibration certificates traceable to national standards. Rental and sale.", expires_at: null },
];

export const SAMPLE_RFQ = `INVITATION TO TENDER – ITT No. NSE-2026-0417 (fictional sample)
Buyer: North Shelf Energy AS (fictional)
Subject: Frame agreement for rental of ROV tooling and torque tools, Norwegian Continental Shelf

1. General
1.1 The Contractor shall submit the tender through the buyer's sourcing portal. Closing date: 2026-12-04 12:00 CET.
1.2 The frame agreement period is 3 years with options of 2 + 1 years.
1.3 Tenders shall be valid for 120 days from the closing date.

2. Technical requirements
2.1 Torque tools shall comply with ISO 13628-8 / API 17H interface classes 1 to 7.
2.2 All tools shall be delivered with calibration certificates traceable to national standards.
2.3 The Contractor shall maintain a rental pool with a minimum of 6 torque tools available at 48 hours' notice.
2.4 Coating of all equipment shall be in accordance with NORSOK M-501, system 7.
2.5 Electrical equipment for hazardous areas shall be ATEX / IECEx certified where applicable.
2.6 The Contractor should offer 24/7 technical support during offshore operations.

3. Quality and documentation
3.1 The Contractor shall hold a valid ISO 9001 certificate.
3.2 Supplier documentation shall be delivered in accordance with NORSOK Z-018 and the attached SDRL.
3.3 An inspection and test plan (ITP) shall be submitted for review 4 weeks before first delivery.

4. HSE
4.1 The Contractor shall have an HSE management system in accordance with NORSOK S-006.
4.2 The Contractor shall report LTI and TRIF figures for the last three years.
4.3 The Contractor shall be qualified in Magnet JQS.

5. Commercial
5.1 Prices shall be stated in NOK, excluding VAT, delivered DAP Mongstad base (Incoterms 2020).
5.2 Payment terms are 45 days net from receipt of correct EHF invoice.
5.3 Liquidated damages of 1% per started week of delay apply, as required.
5.4 The Contractor shall carry product liability insurance of minimum NOK 50 million.

6. Legal
6.1 The Contractor shall answer the buyer's Transparency Act (åpenhetsloven) questionnaire.
6.2 The Contractor shall flow down the Supplier Code of Conduct to all subcontractors.
`;
