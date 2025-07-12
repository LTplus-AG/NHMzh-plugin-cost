---
id: cost-excel
slug: /cost-excel
title: Excel Workflow
sidebar_label: Excel Workflow
---

Bulk editing Kennwerte is easiest in Excel. This page explains the round-trip.

---

## 1. Export Current Kennwerte

1. Click **Export** in the top bar.  
2. Save the generated `kennwerte_<project>_<timestamp>.xlsx`.

---

## 2. File Structure

| Column | Meaning | Editable? |
|--------|---------|-----------|
| `eBKP` | Full code (`C2.01`) | ❌ do not change – key field |
| `Description` | Group name | ✅ optional notes |
| `UnitCost` | CHF per unit | ✅ edit values here |
| `AutoFlag` | `true` / `false` | ❌ indicates system default |

Additions or deletions of rows will be ignored on import.

---

## 3. Import & Validation

1. Click **Import Kennwerte** and drop the edited file.  
2. The plugin shows a **Preview Modal** highlighting:  
   • Green – new values,  
   • Red – invalid numbers (> 1 000 000 or negative),  
   • Yellow – unchanged rows.
3. Press **Apply** to save.

---

## 4. Common Errors

| Error message | Reason | Fix |
|---------------|--------|-----|
| “Unknown eBKP code” | Row eBKP doesn’t exist in project | Keep the original eBKP list; don’t add rows. |
| “UnitCost not a number” | Cell contains text/comma decimal | Use dots as decimal separator (e.g., `123.45`). |
| “Duplicate rows” | Same eBKP appears twice | Remove duplicates before import. |

---

### Tip
After import, use the sidebar pills to spot any remaining **red** groups before confirmation. 