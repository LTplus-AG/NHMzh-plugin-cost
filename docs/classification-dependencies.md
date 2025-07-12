---
id: cost-classification
slug: /cost-classification
title: eBKP Classification & Costs
sidebar_label: eBKP Classification
---

Cost calculations live or die with correct eBKP codes.

---

## 1. How the Plugin Uses eBKP

1. **Lookup Kennwert** → match full code.  
2. **Fallback** → try parent code(s).  
3. **Group sidebar** → organised strictly by eBKP hierarchy.

If an element has no eBKP code it is grouped under **Unclassified** and painted **red** until you add a value manually.

---

## 2. Where Codes Come From

• Passed directly from QTO’s `properties.ebkp_code`.  
• If you imported QTO data without classification, costs will still calculate once you fill Kennwerte manually – but amortisation mapping in LCA will be generic.

---

## 3. Fixing Missing Codes

Same options:

1. **BIM authoring tool** – add `IfcClassificationReference` (source eBKP) and re-upload IFC.  
2. **ifcclassify.com** – rule-based classification and round-trip IFC.

After re-uploading through QTO, open Cost again; new groups appear automatically (blue pill).

---

### Note on Partial Codes

Codes like `C2` are accepted but treated as **broader** groups; you lose detail and risk skewing Kennwerte. Always aim for the most detailed sub-code. 