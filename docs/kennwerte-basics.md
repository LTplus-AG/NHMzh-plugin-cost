---
id: cost-kennwerte
slug: /cost-kennwerte
title: Kennwerte Basics
sidebar_label: Kennwerte Basics
---

Kennwerte are CHF/unit reference values that convert quantities into element costs.

---

## 1. Source of Kennwerte

1. **Previously entered values** get stored by the Plugin.
2. Matched by full eBKP code – `C2.01` before `C2` before `C`.  
3. If nothing matches, the element is flagged until you supply a value.

---

## 2. Colour Legend

| Colour | Meaning |
|--------|---------|
| **Green pill** | Kennwert confirmed by user (saved). |
| **Blue pill** | Auto Kennwert from master table – needs review. |
| **Red pill** | No Kennwert – must be entered before confirmation. |

---

## 3. Unit Mapping

| Quantity type | Unit | Example |
|---------------|------|---------|
| Area | CHF/m² | Walls, slabs |
| Length | CHF/m | Beams, columns |
| Volume | CHF/m³ | Concrete pours |

The plugin picks the correct unit automatically based on IFC QuantitySet.

---

## 4. Hierarchy Fallback Example

1. Element code = **C2.01** → try exact row.  
2. If missing, search **C2**.  
3. Still missing → search **C**.  
4. If no match, element marked red.

---

### Tips

• Aim to fill values at the most detailed level (e.g., `C2.01`).  
• You can override blue values directly in the table or via Excel.  
• Cost plugin never writes back to QTO; it keeps its own cost table.

---

Need more? See the *Excel Workflow* for bulk editing. 