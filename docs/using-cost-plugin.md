---
id: cost-plugin-guide
slug: /cost-plugin-guide
title: Using the Cost Plugin
sidebar_label: Cost Plugin Guide
---

> **Audience:** Project managers, cost estimators, and other *non-technical* stakeholders who need to review or adjust project costs inside the NHMzh platform.

---

## 1. What the Cost Plugin Does

The Cost plugin converts BIM quantities (delivered by the QTO plugin) into Swiss-franc construction costs.  It lets you:

1. **Review automatically calculated unit costs (Kennwerte)** for every eBKP-H group.
2. **Upload or edit unit costs** via Excel, if you prefer to work offline.
3. **Inspect element-level costs** in an interactive table—drill down from building parts to individual elements.
4. **Confirm costs** so the final values flow further to the LCA plugin and dashboards.

You never need to write code or call an API.  Everything happens in the web interface.

---

## 2. Getting Started

1. **Open the Cost web app**  
   Your administrator will provide a URL similar to `https://cost.fastbim5.eu`.  Sign in with your NHMzh account.
2. **Choose your project**  
   The home screen lists all projects that already contain QTO data.  Click a project name to enter the cost workspace.

> ⚠️  If you don’t see your project, make sure the QTO plugin has finished processing the IFC file first.

---

## 3. The Workspace Layout

| Area | Purpose |
|------|---------|
| **Header** | Shows project name & quick stats (total cost, cost / m²). |
| **Sidebar** | eBKP-H hierarchy. Clicking a group filters the table. |
| **Main table** | Elements with quantity, unit, unit cost, and total cost. Supports expand/collapse. |
| **Excel actions** | Buttons to *Export current Kennwerte* or *Import updated Kennwerte*. |
| **Confirm button** | Sends the reviewed costs downstream. Disabled until all eBKP groups have a unit cost. |

---

## 4. Workflow Step-by-Step

### 4.1 Review the auto-calculated Kennwerte

1. Look at the coloured pills next to each eBKP group:
   * **Green** - unit cost already confirmed by a user.
   * **Blue** - auto-calculated by the system; needs your validation.
   * **Red** - missing; upload or enter a value.
2. Click a group to see underlying elements.  Spot-check quantities and costs for plausibility.

### 4.2 Adjust unit costs in-app (quick edits)

1. Hover the unit-cost cell you want to edit and click the ✏️ icon.
2. Enter the new value in CHF and press **Enter**.
3. The table updates immediately; totals recalculate.

### 4.3 Bulk edit with Excel (offline workflow)

1. Press **Export Kennwerte** → an `.xlsx` file downloads.
2. Open it, change values in the *UnitCost* column only.
3. Save the file (keep the same structure, no extra sheets).
4. Back in the app, click **Import Kennwerte** and drop the file.
5. The interface shows a preview—verify and click **Apply**.

### 4.4 Final check & confirmation

1. Ensure there are **no red pills** left in the sidebar.
2. Press **Confirm Costs**.
3. A summary dialog appears—review totals and click **Send**.
4. You’ll see a green toast “Costs sent successfully”.  The LCA plugin is now able to fetch the confirmed costs.

---

## 5. Tips & Troubleshooting

| Issue | Resolution |
|-------|------------|
| Values don’t change after Excel import | Check that you kept the *eBKPCode* column untouched; it’s used as key. |
| “Confirm” button greyed-out | One or more eBKP groups still lack a unit cost (red pill). |
| Large numbers look wrong | The table uses the **quantity** detected by QTO.  If a quantity is off, return to the QTO plugin and fix it first. |
| Network error popup | Wait a few seconds and press **Retry**. If it persists, contact support. |

---

## 6. FAQ

**Q: Can I undo a confirmation?**  
A: Yes. Simply upload new Kennwerte and press **Confirm** again. The latest confirmation overwrites the previous one.

**Q: Do I need to fill in every single element?**  
A: No. You only assign unit costs at the eBKP group level. The plugin multiplies them with the element quantities automatically.

**Q: What happens if I import malformed Excel?**  
A: You’ll get a detailed validation report listing row numbers and issues. Correct them and re-upload.

---

### Need help?
Reach the NHMzh support team via **support@fastbim5.eu**. 